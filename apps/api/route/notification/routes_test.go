package notification

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/dynamic/fake"
	k8stesting "k8s.io/client-go/testing"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"

	notificationsvc "sealos/api/service/notification"
)

func newTestAPI() (chi.Router, huma.API) {
	router := chi.NewRouter()
	api := humachi.New(router, huma.DefaultConfig("test", "0.0.0"))
	Register(api)
	return router, api
}

// A kubeconfig the auth middleware accepts: inline bearer token, one context
// with a namespace. Off-cluster transport needs NODE_ENV=development.
const testKubeconfig = `apiVersion: v1
clusters:
- cluster:
    server: https://example.test
  name: c
contexts:
- context:
    cluster: c
    namespace: ns-a
    user: u
  name: ctx
current-context: ctx
users:
- name: u
  user:
    token: test-token
`

func testAuthorization() string {
	return "Bearer " + url.QueryEscape(testKubeconfig)
}

func fakeCluster(t *testing.T, objects ...runtime.Object) dynamic.Interface {
	t.Helper()
	t.Setenv("NODE_ENV", "development")
	client := fake.NewSimpleDynamicClientWithCustomListKinds(
		runtime.NewScheme(),
		map[schema.GroupVersionResource]string{notificationsvc.GVR: "NotificationList"},
		objects...,
	)
	previousList, previousRead := listNotifications, markNotificationRead
	listNotifications = func(ctx context.Context, _ *clientcmdapi.Config, namespace string) (*notificationsvc.ListResult, error) {
		return notificationsvc.ListWithClient(ctx, client, namespace, time.Date(2026, 8, 27, 12, 0, 0, 0, time.UTC))
	}
	markNotificationRead = func(ctx context.Context, _ *clientcmdapi.Config, namespace string, name string) (*notificationsvc.ReadResult, error) {
		return notificationsvc.MarkReadWithClient(ctx, client, namespace, name)
	}
	t.Cleanup(func() {
		listNotifications, markNotificationRead = previousList, previousRead
	})
	return client
}

func testNotification(name string, isRead string, timestamp int64) *unstructured.Unstructured {
	return &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "notification.sealos.io/v1",
		"kind":       "Notification",
		"metadata": map[string]interface{}{
			"name":      name,
			"namespace": "ns-a",
			"labels":    map[string]interface{}{"isRead": isRead},
		},
		"spec": map[string]interface{}{
			"title":     "Balance exhausted",
			"message":   "Services are suspended.",
			"from":      "Debt-System",
			"timestamp": timestamp,
		},
	}}
}

func TestRegisterExposesListAndMarkRead(t *testing.T) {
	_, api := newTestAPI()

	list := api.OpenAPI().Paths["/api/notification/v1alpha1/"]
	if list == nil || list.Get == nil {
		t.Fatalf("expected GET /api/notification/v1alpha1/ to be registered")
	}
	if list.Get.OperationID != "notification-list" {
		t.Fatalf("unexpected list operation ID: %q", list.Get.OperationID)
	}

	read := api.OpenAPI().Paths["/api/notification/v1alpha1/{name}/read"]
	if read == nil || read.Patch == nil {
		t.Fatalf("expected PATCH /api/notification/v1alpha1/{name}/read to be registered")
	}
	if read.Patch.OperationID != "notification-mark-read" {
		t.Fatalf("unexpected mark-read operation ID: %q", read.Patch.OperationID)
	}
}

func TestListRequiresAuthorizationAtHTTPBoundary(t *testing.T) {
	router, _ := newTestAPI()

	req := httptest.NewRequest(http.MethodGet, "/api/notification/v1alpha1/?namespace=ns-a", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected a missing Authorization header to be rejected, got %d: %s", w.Code, w.Body.String())
	}
}

func TestListRejectsInvalidKubeconfigBeforeTouchingTheCluster(t *testing.T) {
	router, _ := newTestAPI()

	req := httptest.NewRequest(http.MethodGet, "/api/notification/v1alpha1/?namespace=ns-a", nil)
	req.Header.Set("Authorization", "Bearer not-a-kubeconfig")
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected an invalid kubeconfig to answer 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestListServesTheNamespaceNotificationsNewestFirst(t *testing.T) {
	fakeCluster(t,
		testNotification("debt-choice-debtperiod", "false", 1756200000),
		testNotification("workspace-debt-debt", "true", 1756300000),
	)
	router, _ := newTestAPI()

	req := httptest.NewRequest(http.MethodGet, "/api/notification/v1alpha1/?namespace=ns-a", nil)
	req.Header.Set("Authorization", testAuthorization())
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var body notificationsvc.ListResult
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("response is not JSON: %v", err)
	}
	if body.Namespace != "ns-a" || len(body.Items) != 2 {
		t.Fatalf("unexpected body: %+v", body)
	}
	if body.Items[0].Name != "workspace-debt-debt" || !body.Items[0].IsRead {
		t.Fatalf("expected the newest, read CR first, got %+v", body.Items[0])
	}
	if body.Items[1].Name != "debt-choice-debtperiod" || body.Items[1].IsRead || body.Items[1].Title != "Balance exhausted" {
		t.Fatalf("expected the unread debt CR with upstream copy as-is, got %+v", body.Items[1])
	}
}

func TestMarkReadPatchesTheLabelThroughTheRoute(t *testing.T) {
	client := fakeCluster(t, testNotification("debt-choice-debtperiod", "false", 1756200000))
	router, _ := newTestAPI()

	req := httptest.NewRequest(http.MethodPatch, "/api/notification/v1alpha1/debt-choice-debtperiod/read?namespace=ns-a", nil)
	req.Header.Set("Authorization", testAuthorization())
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var body notificationsvc.ReadResult
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("response is not JSON: %v", err)
	}
	if !body.IsRead || body.Name != "debt-choice-debtperiod" {
		t.Fatalf("unexpected body: %+v", body)
	}
	obj, err := client.Resource(notificationsvc.GVR).Namespace("ns-a").Get(context.Background(), "debt-choice-debtperiod", metav1.GetOptions{})
	if err != nil {
		t.Fatalf("re-reading the CR failed: %v", err)
	}
	if obj.GetLabels()[notificationsvc.ReadLabel] != "true" {
		t.Fatalf("expected the isRead label to be true, got %q", obj.GetLabels()[notificationsvc.ReadLabel])
	}
}

func TestMarkReadMapsClusterForbiddenTo403(t *testing.T) {
	client := fakeCluster(t, testNotification("debt-choice-debtperiod", "false", 1756200000))
	// A Developer's kubeconfig can read but not patch: the apiserver answers
	// Forbidden, which the route must pass through so the client can skip.
	client.(*fake.FakeDynamicClient).PrependReactor("patch", "notifications", func(k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, apierrors.NewForbidden(notificationsvc.GVR.GroupResource(), "debt-choice-debtperiod", errors.New("developer role"))
	})
	router, _ := newTestAPI()

	req := httptest.NewRequest(http.MethodPatch, "/api/notification/v1alpha1/debt-choice-debtperiod/read?namespace=ns-a", nil)
	req.Header.Set("Authorization", testAuthorization())
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", w.Code, w.Body.String())
	}
}

func TestMarkReadMapsMissingCRTo404(t *testing.T) {
	fakeCluster(t)
	router, _ := newTestAPI()

	req := httptest.NewRequest(http.MethodPatch, "/api/notification/v1alpha1/missing/read?namespace=ns-a", nil)
	req.Header.Set("Authorization", testAuthorization())
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

func TestK8sErrorStatusMapping(t *testing.T) {
	resource := notificationsvc.GVR.GroupResource()
	tests := []struct {
		name string
		err  error
		want int
	}{
		{name: "not found", err: apierrors.NewNotFound(resource, "x"), want: http.StatusNotFound},
		{name: "forbidden", err: apierrors.NewForbidden(resource, "x", errors.New("rbac")), want: http.StatusForbidden},
		{name: "unauthorized", err: apierrors.NewUnauthorized("bad token"), want: http.StatusUnauthorized},
		{name: "anything else", err: errors.New("boom"), want: http.StatusInternalServerError},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := mapK8sError("failed", tt.err)
			statusErr, ok := err.(huma.StatusError)
			if !ok {
				t.Fatalf("expected Huma status error, got %T", err)
			}
			if statusErr.GetStatus() != tt.want {
				t.Fatalf("expected status %d, got %d", tt.want, statusErr.GetStatus())
			}
		})
	}
}
