package notification

import (
	"context"
	"testing"
	"time"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/dynamic/fake"
)

func testClient(objects ...runtime.Object) dynamic.Interface {
	return fake.NewSimpleDynamicClientWithCustomListKinds(
		runtime.NewScheme(),
		map[schema.GroupVersionResource]string{GVR: "NotificationList"},
		objects...,
	)
}

func testNotification(name, namespace string, isRead string, spec map[string]interface{}) *unstructured.Unstructured {
	metadata := map[string]interface{}{
		"name":              name,
		"namespace":         namespace,
		"uid":               "uid-" + name,
		"creationTimestamp": "2026-08-20T10:00:00Z",
	}
	if isRead != "" {
		metadata["labels"] = map[string]interface{}{"isRead": isRead}
	}
	return &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "notification.sealos.io/v1",
		"kind":       "Notification",
		"metadata":   metadata,
		"spec":       spec,
	}}
}

func testNow() time.Time {
	return time.Date(2026, 8, 27, 12, 0, 0, 0, time.UTC)
}

func TestListWithClientFlattensAndOrdersNewestFirst(t *testing.T) {
	client := testClient(
		testNotification("debt-choice-debtperiod", "ns-a", "false", map[string]interface{}{
			"title":        "Balance exhausted",
			"message":      "Your services will be suspended.",
			"from":         "Debt-System",
			"importance":   "High",
			"desktopPopup": true,
			"timestamp":    int64(1756200000),
			"i18ns":        map[string]interface{}{"zh": map[string]interface{}{"title": "余额耗尽"}},
		}),
		testNotification("workspace-debt-debt", "ns-a", "true", map[string]interface{}{
			"title":     "Workspace suspended",
			"message":   "Renew to resume.",
			"from":      "Workspace-Subscription-System",
			"timestamp": int64(1756300000),
		}),
		testNotification("other-namespace", "ns-b", "false", map[string]interface{}{
			"title":     "Not mine",
			"message":   "",
			"timestamp": int64(1756400000),
		}),
	)

	got, err := ListWithClient(context.Background(), client, "ns-a", testNow())
	if err != nil {
		t.Fatalf("ListWithClient returned error: %v", err)
	}
	if got.Namespace != "ns-a" {
		t.Fatalf("expected namespace ns-a, got %q", got.Namespace)
	}
	if len(got.Items) != 2 {
		t.Fatalf("expected 2 items in ns-a, got %d: %+v", len(got.Items), got.Items)
	}
	first, second := got.Items[0], got.Items[1]
	if first.Name != "workspace-debt-debt" || second.Name != "debt-choice-debtperiod" {
		t.Fatalf("expected newest first, got %q then %q", first.Name, second.Name)
	}
	if !first.IsRead || second.IsRead {
		t.Fatalf("expected isRead to follow the label: first=%v second=%v", first.IsRead, second.IsRead)
	}
	if second.Title != "Balance exhausted" || second.Message != "Your services will be suspended." {
		t.Fatalf("unexpected copy: %+v", second)
	}
	if second.From != "Debt-System" || second.Importance != "High" || !second.DesktopPopup {
		t.Fatalf("unexpected metadata: %+v", second)
	}
	if second.Timestamp != 1756200000 {
		t.Fatalf("expected spec.timestamp to pass through, got %d", second.Timestamp)
	}
	if second.CreationTimestamp != "2026-08-20T10:00:00Z" {
		t.Fatalf("expected creationTimestamp to pass through, got %q", second.CreationTimestamp)
	}
	if second.Version != 1756200000 {
		t.Fatalf("expected the id version to be spec.timestamp, got %d", second.Version)
	}
}

func TestListWithClientFallsBackToCreationTimestampAndTreatsMissingLabelAsUnread(t *testing.T) {
	announcement := testNotification("announcement", "ns-a", "", map[string]interface{}{
		"title":   "Welcome",
		"message": "Hello",
	})
	announcement.SetGeneration(3)
	client := testClient(announcement)

	got, err := ListWithClient(context.Background(), client, "ns-a", testNow())
	if err != nil {
		t.Fatalf("ListWithClient returned error: %v", err)
	}
	if len(got.Items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(got.Items))
	}
	item := got.Items[0]
	if item.IsRead {
		t.Fatalf("expected a CR without the isRead label to be unread")
	}
	wantCreated := time.Date(2026, 8, 20, 10, 0, 0, 0, time.UTC).Unix()
	if item.Timestamp != wantCreated {
		t.Fatalf("expected timestamp to fall back to creationTimestamp %d, got %d", wantCreated, item.Timestamp)
	}
	// The display time may fall back to creation, but the id must not: an
	// in-place overwrite keeps creationTimestamp and bumps generation.
	if item.Version != 3 {
		t.Fatalf("expected the id version to fall back to metadata.generation 3, got %d", item.Version)
	}
}

func TestListWithClientHonoursStartAndEndWindows(t *testing.T) {
	client := testClient(
		testNotification("not-yet", "ns-a", "false", map[string]interface{}{
			"title":     "Scheduled",
			"message":   "",
			"timestamp": int64(1),
			"startTime": "2026-09-01T00:00:00Z",
		}),
		testNotification("expired", "ns-a", "false", map[string]interface{}{
			"title":     "Old",
			"message":   "",
			"timestamp": int64(2),
			"endTime":   "2026-08-01T00:00:00Z",
		}),
		testNotification("live", "ns-a", "false", map[string]interface{}{
			"title":     "Live",
			"message":   "",
			"timestamp": int64(3),
			"startTime": "2026-08-01T00:00:00Z",
			"endTime":   "2026-09-01T00:00:00Z",
		}),
	)

	got, err := ListWithClient(context.Background(), client, "ns-a", testNow())
	if err != nil {
		t.Fatalf("ListWithClient returned error: %v", err)
	}
	if len(got.Items) != 1 || got.Items[0].Name != "live" {
		t.Fatalf("expected only the live notification, got %+v", got.Items)
	}
}

func TestListWithClientRequiresNamespace(t *testing.T) {
	if _, err := ListWithClient(context.Background(), testClient(), "  ", testNow()); err == nil {
		t.Fatalf("expected an error for a blank namespace")
	}
}

func TestMarkReadWithClientPatchesTheReadLabel(t *testing.T) {
	client := testClient(
		testNotification("debt-choice-debtperiod", "ns-a", "false", map[string]interface{}{
			"title":     "Balance exhausted",
			"message":   "",
			"timestamp": int64(1756200000),
		}),
	)

	got, err := MarkReadWithClient(context.Background(), client, "ns-a", "debt-choice-debtperiod")
	if err != nil {
		t.Fatalf("MarkReadWithClient returned error: %v", err)
	}
	if !got.IsRead || got.Name != "debt-choice-debtperiod" || got.Namespace != "ns-a" {
		t.Fatalf("unexpected read result: %+v", got)
	}

	listed, err := ListWithClient(context.Background(), client, "ns-a", testNow())
	if err != nil {
		t.Fatalf("ListWithClient returned error: %v", err)
	}
	if len(listed.Items) != 1 || !listed.Items[0].IsRead {
		t.Fatalf("expected the CR to read back as read, got %+v", listed.Items)
	}
	if listed.Items[0].Title != "Balance exhausted" {
		t.Fatalf("expected the merge patch to leave spec untouched, got %+v", listed.Items[0])
	}
}

func TestMarkReadWithClientSurfacesNotFound(t *testing.T) {
	_, err := MarkReadWithClient(context.Background(), testClient(), "ns-a", "missing")
	if err == nil || !apierrors.IsNotFound(err) {
		t.Fatalf("expected a NotFound error, got %v", err)
	}
}

func TestMarkReadWithClientRequiresName(t *testing.T) {
	if _, err := MarkReadWithClient(context.Background(), testClient(), "ns-a", " "); err == nil {
		t.Fatalf("expected an error for a blank name")
	}
}
