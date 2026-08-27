// Package notification reads the platform's Notification CRs
// (`notifications.notification.sealos.io/v1`) for the Notification Center.
//
// The platform is the single source of truth for these messages: the account
// and workspace-subscription controllers write fixed-name CRs (for example
// `debt-choice-debtperiod`, `workspace-debt-debt`) into every user namespace,
// overwrite them in place when a state escalates (flipping `isRead` back to
// "false"), and mark them read again on recovery. Brain never copies them —
// it lists them with the caller's own kubeconfig and patches the same
// `isRead` label the Sealos desktop uses, so both surfaces agree.
package notification

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/dynamic"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"

	"sealos/api/middleware"
)

// GVR is the upstream Notification CRD resource.
var GVR = schema.GroupVersionResource{
	Group:    "notification.sealos.io",
	Version:  "v1",
	Resource: "notifications",
}

// ReadLabel is the CR label the platform and the desktop use for read state.
const ReadLabel = "isRead"

// Item is one platform Notification, flattened for the UI. Copy is the CR's
// default language as written by upstream; `i18ns` is deliberately dropped.
type Item struct {
	Name              string `json:"name" doc:"CR metadata.name; fixed per upstream scenario and overwritten in place"`
	Namespace         string `json:"namespace"`
	UID               string `json:"uid,omitempty"`
	IsRead            bool   `json:"isRead" doc:"metadata.labels.isRead == \"true\""`
	Title             string `json:"title"`
	Message           string `json:"message"`
	From              string `json:"from,omitempty"`
	Importance        string `json:"importance,omitempty" doc:"High, Medium, or Low"`
	DesktopPopup      bool   `json:"desktopPopup"`
	Timestamp         int64  `json:"timestamp" doc:"spec.timestamp (Unix seconds); creationTimestamp when upstream omitted it"`
	CreationTimestamp string `json:"creationTimestamp,omitempty"`
}

// ListResult is the list response body.
type ListResult struct {
	Namespace string `json:"namespace"`
	Items     []Item `json:"items"`
}

// ReadResult is the mark-read response body.
type ReadResult struct {
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	IsRead    bool   `json:"isRead"`
}

type dynamicClientFunc func(*clientcmdapi.Config, string) (dynamic.Interface, string, error)

var dynamicClientFactory dynamicClientFunc = defaultDynamicClientFactory

func defaultDynamicClientFactory(cfg *clientcmdapi.Config, ns string) (dynamic.Interface, string, error) {
	resolved, err := middleware.ResolveContext(cfg, middleware.ResolveOptions{Namespace: ns})
	if err != nil {
		return nil, "", err
	}
	if strings.TrimSpace(resolved.Namespace) == "" {
		return nil, "", fmt.Errorf("namespace is required")
	}
	client, err := dynamic.NewForConfig(resolved.RestConfig)
	if err != nil {
		return nil, "", err
	}
	return client, resolved.Namespace, nil
}

// List returns the namespace's live Notification CRs using the caller's kubeconfig.
func List(ctx context.Context, cfg *clientcmdapi.Config, namespace string) (*ListResult, error) {
	client, ns, err := dynamicClientFactory(cfg, namespace)
	if err != nil {
		return nil, err
	}
	return ListWithClient(ctx, client, ns, time.Now())
}

// MarkRead flips the CR's `isRead` label to "true" using the caller's kubeconfig.
func MarkRead(ctx context.Context, cfg *clientcmdapi.Config, namespace string, name string) (*ReadResult, error) {
	client, ns, err := dynamicClientFactory(cfg, namespace)
	if err != nil {
		return nil, err
	}
	return MarkReadWithClient(ctx, client, ns, name)
}

// ListWithClient lists the namespace's Notification CRs, drops entries outside
// their optional `startTime`/`endTime` window (the desktop's rule), and orders
// them newest first.
func ListWithClient(ctx context.Context, client dynamic.Interface, namespace string, now time.Time) (*ListResult, error) {
	namespace = strings.TrimSpace(namespace)
	if namespace == "" {
		return nil, fmt.Errorf("namespace is required")
	}
	list, err := client.Resource(GVR).Namespace(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	items := make([]Item, 0, len(list.Items))
	for i := range list.Items {
		item, visible := itemFromUnstructured(&list.Items[i], now)
		if visible {
			items = append(items, item)
		}
	}
	sort.SliceStable(items, func(a, b int) bool {
		if items[a].Timestamp != items[b].Timestamp {
			return items[a].Timestamp > items[b].Timestamp
		}
		return items[a].Name < items[b].Name
	})
	return &ListResult{Namespace: namespace, Items: items}, nil
}

// MarkReadWithClient merge-patches `metadata.labels.isRead: "true"` on one CR —
// the same write the Sealos desktop performs, so the desktop bell follows.
func MarkReadWithClient(ctx context.Context, client dynamic.Interface, namespace string, name string) (*ReadResult, error) {
	namespace = strings.TrimSpace(namespace)
	name = strings.TrimSpace(name)
	if namespace == "" {
		return nil, fmt.Errorf("namespace is required")
	}
	if name == "" {
		return nil, fmt.Errorf("name is required")
	}
	patch, err := json.Marshal(map[string]interface{}{
		"metadata": map[string]interface{}{
			"labels": map[string]string{ReadLabel: "true"},
		},
	})
	if err != nil {
		return nil, err
	}
	obj, err := client.Resource(GVR).Namespace(namespace).Patch(ctx, name, types.MergePatchType, patch, metav1.PatchOptions{})
	if err != nil {
		return nil, err
	}
	return &ReadResult{
		Name:      obj.GetName(),
		Namespace: obj.GetNamespace(),
		IsRead:    obj.GetLabels()[ReadLabel] == "true",
	}, nil
}

func itemFromUnstructured(obj *unstructured.Unstructured, now time.Time) (Item, bool) {
	spec, _, _ := unstructured.NestedMap(obj.Object, "spec")
	if startedAt, ok := parseMetaTime(spec["startTime"]); ok && now.Before(startedAt) {
		return Item{}, false
	}
	if endedAt, ok := parseMetaTime(spec["endTime"]); ok && !now.Before(endedAt) {
		return Item{}, false
	}
	item := Item{
		Name:         obj.GetName(),
		Namespace:    obj.GetNamespace(),
		UID:          string(obj.GetUID()),
		IsRead:       obj.GetLabels()[ReadLabel] == "true",
		Title:        stringField(spec, "title"),
		Message:      stringField(spec, "message"),
		From:         stringField(spec, "from"),
		Importance:   stringField(spec, "importance"),
		DesktopPopup: boolField(spec, "desktopPopup"),
		Timestamp:    int64Field(spec, "timestamp"),
	}
	created := obj.GetCreationTimestamp()
	if !created.IsZero() {
		item.CreationTimestamp = created.UTC().Format(time.RFC3339)
		if item.Timestamp == 0 {
			item.Timestamp = created.Unix()
		}
	}
	return item, true
}

func parseMetaTime(value interface{}) (time.Time, bool) {
	raw, ok := value.(string)
	if !ok || strings.TrimSpace(raw) == "" {
		return time.Time{}, false
	}
	parsed, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		return time.Time{}, false
	}
	return parsed, true
}

func stringField(m map[string]interface{}, key string) string {
	value, _ := m[key].(string)
	return value
}

func boolField(m map[string]interface{}, key string) bool {
	value, _ := m[key].(bool)
	return value
}

func int64Field(m map[string]interface{}, key string) int64 {
	switch value := m[key].(type) {
	case int64:
		return value
	case int:
		return int64(value)
	case float64:
		return int64(value)
	case json.Number:
		parsed, err := value.Int64()
		if err == nil {
			return parsed
		}
	}
	return 0
}
