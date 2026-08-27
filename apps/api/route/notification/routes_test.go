package notification

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
)

func newTestAPI() (chi.Router, huma.API) {
	router := chi.NewRouter()
	api := humachi.New(router, huma.DefaultConfig("test", "0.0.0"))
	Register(api)
	return router, api
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

func TestMarkReadRejectsInvalidKubeconfigBeforeTouchingTheCluster(t *testing.T) {
	router, _ := newTestAPI()

	req := httptest.NewRequest(http.MethodPatch, "/api/notification/v1alpha1/debt-choice-debtperiod/read?namespace=ns-a", nil)
	req.Header.Set("Authorization", "Bearer not-a-kubeconfig")
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected an invalid kubeconfig to answer 400, got %d: %s", w.Code, w.Body.String())
	}
}
