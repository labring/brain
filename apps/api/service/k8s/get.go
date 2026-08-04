package k8s

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
	"sigs.k8s.io/yaml"

	"sealos/api/middleware"
	aptransform "sealos/api/service/transform/ap"
)

const (
	brainDeploymentKindLabel = "brain.io/deployment-kind"
	brainDeploymentNameLabel = "brain.io/deployment-name"
	directAPDeploymentKind   = "ap"
)

// GetOptions holds options for Get, mimicking kubectl get flags.
type GetOptions struct {
	// Resource is the resource type (e.g. "pods", "po", "deployments", "deploy").
	Resource string
	// Name is the resource name. If empty, lists all resources of the type.
	Name string
	// Namespace limits results to this namespace. Empty uses kubeconfig current context or default.
	Namespace string
	// LabelSelector filters by labels (e.g. "app=nginx").
	LabelSelector string
	// FieldSelector filters by fields (e.g. "metadata.name=my-pod").
	FieldSelector string
}

type UnknownResourceError struct {
	Resource string
}

func (err UnknownResourceError) Error() string {
	return fmt.Sprintf("unknown resource %q", err.Resource)
}

func IsUnknownResourceError(err error, resource string) bool {
	var unknownResourceErr UnknownResourceError
	if !errors.As(err, &unknownResourceErr) {
		return false
	}
	return resource == "" || unknownResourceErr.Resource == resource
}

// Get retrieves Kubernetes resources and returns them as JSON.
// Use GetOptions.Resource for the type (pods, deploy, etc.) and GetOptions.Name for a specific resource.
// Namespace is read from cfg's current context when opts.Namespace is empty.
func Get(cfg *clientcmdapi.Config, opts GetOptions) ([]byte, error) {
	resolvedCtx, err := middleware.ResolveContext(cfg, middleware.ResolveOptions{
		Namespace:        opts.Namespace,
		DefaultNamespace: corev1.NamespaceDefault,
	})
	if err != nil {
		return nil, err
	}
	client, err := dynamic.NewForConfig(resolvedCtx.RestConfig)
	if err != nil {
		return nil, err
	}
	clientset, err := kubernetes.NewForConfig(resolvedCtx.RestConfig)
	if err != nil {
		return nil, err
	}
	gvr, namespaced, err := sharedDiscovery.resolveResource(
		resolvedCtx.RestConfig.Host, clientset.Discovery(), opts.Resource)
	if err != nil {
		return nil, err
	}

	ctx := context.Background()
	listOpts := metav1.ListOptions{
		LabelSelector: opts.LabelSelector,
		FieldSelector: opts.FieldSelector,
	}

	ns := resolvedCtx.Namespace
	if !namespaced {
		ns = ""
	}

	if opts.Name != "" {
		obj, err := client.Resource(gvr).Namespace(ns).Get(ctx, opts.Name, metav1.GetOptions{})
		if err != nil {
			return nil, err
		}
		outObj := obj.Object
		if isAPObject(outObj) {
			ingresses, err := listIngressesByComposite(resolvedCtx.RestConfig, outObj)
			if err != nil {
				return nil, err
			}
			services, err := listServicesByComposite(resolvedCtx.RestConfig, outObj)
			if err != nil {
				return nil, err
			}
			backups, err := listSnapshotBackupsByAP(resolvedCtx.RestConfig, outObj)
			if err != nil {
				return nil, err
			}
			outObj = aptransform.APWithIngressesServicesAndBackups(outObj, ingresses, services, backups)
		}
		stripManagedFields(outObj)
		return json.Marshal(outObj)
	}

	var list *unstructured.UnstructuredList
	if namespaced {
		list, err = client.Resource(gvr).Namespace(ns).List(ctx, listOpts)
	} else {
		list, err = client.Resource(gvr).List(ctx, listOpts)
	}
	if err != nil {
		return nil, err
	}
	// Build response with items; list.Object does not include items (they are in list.Items).
	out := make(map[string]interface{})
	if list.Object != nil {
		for k, v := range list.Object {
			if k != "items" {
				out[k] = v
			}
		}
	}
	items := make([]map[string]interface{}, 0, len(list.Items))
	for i := range list.Items {
		item := list.Items[i].Object
		if isAPObject(item) {
			ingresses, err := listIngressesByComposite(resolvedCtx.RestConfig, item)
			if err != nil {
				return nil, err
			}
			services, err := listServicesByComposite(resolvedCtx.RestConfig, item)
			if err != nil {
				return nil, err
			}
			backups, err := listSnapshotBackupsByAP(resolvedCtx.RestConfig, item)
			if err != nil {
				return nil, err
			}
			item = aptransform.APWithIngressesServicesAndBackups(item, ingresses, services, backups)
		}
		stripManagedFields(item)
		items = append(items, item)
	}
	out["items"] = items
	stripManagedFields(out)
	return json.Marshal(out)
}

func stripManagedFields(v interface{}) {
	switch obj := v.(type) {
	case map[string]interface{}:
		if metadata, ok := obj["metadata"].(map[string]interface{}); ok {
			delete(metadata, "managedFields")
		}
		for _, child := range obj {
			stripManagedFields(child)
		}
	case []interface{}:
		for _, child := range obj {
			stripManagedFields(child)
		}
	}
}

func isAPObject(obj map[string]interface{}) bool {
	if obj == nil {
		return false
	}
	kind, _ := obj["kind"].(string)
	return kind == "AP"
}

func listIngressesByComposite(restConfig *rest.Config, ap map[string]interface{}) ([]map[string]interface{}, error) {
	meta, _ := ap["metadata"].(map[string]interface{})
	if meta == nil {
		return nil, nil
	}
	apName, _ := meta["name"].(string)
	apNamespace, _ := meta["namespace"].(string)
	if apName == "" {
		return nil, nil
	}
	client, err := dynamic.NewForConfig(restConfig)
	if err != nil {
		return nil, err
	}
	gvr := schema.GroupVersionResource{Group: "networking.k8s.io", Version: "v1", Resource: "ingresses"}
	labelSelector := brainDeploymentKindLabel + "=" + directAPDeploymentKind + "," + brainDeploymentNameLabel + "=" + apName
	list, err := client.Resource(gvr).Namespace(apNamespace).List(context.Background(), metav1.ListOptions{
		LabelSelector: labelSelector,
	})
	if err != nil {
		return nil, err
	}
	items := make([]map[string]interface{}, 0, len(list.Items))
	for i := range list.Items {
		items = append(items, list.Items[i].Object)
	}
	return items, nil
}

// listSnapshotBackupsByAP lists orphaned snapshot ConfigMaps for an AP (app.sealos.io/ap-uid, -config-snapshot- in name),
// excluding the managed backup. Returns concise summaries: name, image, createdAt.
func listSnapshotBackupsByAP(restConfig *rest.Config, ap map[string]interface{}) ([]map[string]interface{}, error) {
	meta, _ := ap["metadata"].(map[string]interface{})
	if meta == nil {
		return nil, nil
	}
	apUID, _ := meta["uid"].(string)
	apNamespace, _ := meta["namespace"].(string)
	if apUID == "" || apNamespace == "" {
		return nil, nil
	}
	client, err := dynamic.NewForConfig(restConfig)
	if err != nil {
		return nil, err
	}
	gvr := schema.GroupVersionResource{Group: "", Version: "v1", Resource: "configmaps"}
	labelSelector := "app.sealos.io/ap-uid=" + apUID + ",app.sealos.io/backup=true"
	list, err := client.Resource(gvr).Namespace(apNamespace).List(context.Background(), metav1.ListOptions{
		LabelSelector: labelSelector,
	})
	if err != nil {
		return nil, err
	}
	var summaries []map[string]interface{}
	for i := range list.Items {
		cm := list.Items[i].Object
		name := getStringFromMap(cm, "metadata", "name")
		if name == "" || !strings.Contains(name, "-config-snapshot-") {
			continue
		}
		createdAt := getStringFromMap(cm, "metadata", "creationTimestamp")
		image := ""
		if data, _ := cm["data"].(map[string]interface{}); data != nil {
			if configYaml, _ := data["config.yaml"].(string); configYaml != "" {
				var spec map[string]interface{}
				if err := yaml.Unmarshal([]byte(configYaml), &spec); err == nil {
					if img, _ := spec["image"].(string); img != "" {
						image = img
					}
				}
			}
		}
		summaries = append(summaries, map[string]interface{}{
			"name":      name,
			"image":     image,
			"createdAt": createdAt,
		})
	}
	sort.Slice(summaries, func(i, j int) bool {
		ai, _ := summaries[i]["createdAt"].(string)
		aj, _ := summaries[j]["createdAt"].(string)
		return ai > aj
	})
	return summaries, nil
}

func getStringFromMap(obj map[string]interface{}, keys ...string) string {
	for i, k := range keys {
		if obj == nil {
			return ""
		}
		v, _ := obj[k]
		if i == len(keys)-1 {
			if s, ok := v.(string); ok {
				return s
			}
			return ""
		}
		obj, _ = v.(map[string]interface{})
	}
	return ""
}

func listServicesByComposite(restConfig *rest.Config, ap map[string]interface{}) ([]map[string]interface{}, error) {
	meta, _ := ap["metadata"].(map[string]interface{})
	if meta == nil {
		return nil, nil
	}
	apName, _ := meta["name"].(string)
	apNamespace, _ := meta["namespace"].(string)
	if apName == "" {
		return nil, nil
	}
	client, err := dynamic.NewForConfig(restConfig)
	if err != nil {
		return nil, err
	}
	gvr := schema.GroupVersionResource{Group: "", Version: "v1", Resource: "services"}
	labelSelector := brainDeploymentKindLabel + "=" + directAPDeploymentKind + "," + brainDeploymentNameLabel + "=" + apName
	list, err := client.Resource(gvr).Namespace(apNamespace).List(context.Background(), metav1.ListOptions{
		LabelSelector: labelSelector,
	})
	if err != nil {
		return nil, err
	}
	items := make([]map[string]interface{}, 0, len(list.Items))
	for i := range list.Items {
		items = append(items, list.Items[i].Object)
	}
	return items, nil
}
