package metrics

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
)

func TestRegisterIncludesSnapshotRoute(t *testing.T) {
	router := chi.NewRouter()
	api := humachi.New(router, huma.DefaultConfig("test", "0.0.0"))

	Register(api)

	path := api.OpenAPI().Paths["/metrics/snapshot"]
	if path == nil || path.Post == nil {
		t.Fatalf("expected POST /metrics/snapshot to be registered")
	}
	if path.Post.OperationID != "metrics-snapshot" {
		t.Fatalf("unexpected operation ID: %q", path.Post.OperationID)
	}
}

func TestRegisterIncludesSeriesRoute(t *testing.T) {
	router := chi.NewRouter()
	api := humachi.New(router, huma.DefaultConfig("test", "0.0.0"))

	Register(api)

	path := api.OpenAPI().Paths["/metrics/series"]
	if path == nil || path.Post == nil {
		t.Fatalf("expected POST /metrics/series to be registered")
	}
	if path.Post.OperationID != "metrics-series" {
		t.Fatalf("unexpected operation ID: %q", path.Post.OperationID)
	}
}

func TestRegisterOmitsLegacySingleResourceMetricsRoute(t *testing.T) {
	router := chi.NewRouter()
	api := humachi.New(router, huma.DefaultConfig("test", "0.0.0"))

	Register(api)

	if path := api.OpenAPI().Paths["/metrics"]; path != nil {
		t.Fatalf("expected legacy GET /metrics route to be removed, got %#v", path)
	}
}

func TestMetricsHealthReportsVictoriaMetricsConfiguration(t *testing.T) {
	tests := []struct {
		name  string
		vmURL string
		want  string
	}{
		{name: "missing", vmURL: "", want: "degraded"},
		{name: "configured", vmURL: "http://vmselect.monitoring:8481", want: "configured"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("VMSELECT_URL", tt.vmURL)

			router := chi.NewRouter()
			api := humachi.New(router, huma.DefaultConfig("test", "0.0.0"))
			Register(api)

			req := httptest.NewRequest(http.MethodGet, "/metrics/health", nil)
			w := httptest.NewRecorder()

			router.ServeHTTP(w, req)

			if w.Code != http.StatusOK {
				t.Fatalf("expected health status 200, got %d: %s", w.Code, w.Body.String())
			}
			var body struct {
				Status string `json:"status"`
			}
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode health response: %v", err)
			}
			if body.Status != tt.want {
				t.Fatalf("status = %q, want %q", body.Status, tt.want)
			}
		})
	}
}

func TestSnapshotRejectsRangeControlsAtHTTPBoundary(t *testing.T) {
	router := chi.NewRouter()
	api := humachi.New(router, huma.DefaultConfig("test", "0.0.0"))
	Register(api)

	body := []byte(`{
		"targets": [{"kind": "ap", "namespace": "project-a", "name": "web"}],
		"start": "2026-05-18T00:00:00Z"
	}`)
	req := httptest.NewRequest(http.MethodPost, "/metrics/snapshot", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer not-a-kubeconfig")
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected range field to be rejected before auth, got %d: %s", w.Code, w.Body.String())
	}
	if !bytes.Contains(w.Body.Bytes(), []byte("unexpected property")) || !bytes.Contains(w.Body.Bytes(), []byte("body.start")) {
		t.Fatalf("expected body.start schema rejection, got: %s", w.Body.String())
	}
}

func TestSeriesRejectsBatchTargetsAtHTTPBoundary(t *testing.T) {
	router := chi.NewRouter()
	api := humachi.New(router, huma.DefaultConfig("test", "0.0.0"))
	Register(api)

	body := []byte(`{
		"targets": [{"kind": "ap", "namespace": "project-a", "name": "web"}],
		"start": "2026-05-18T00:00:00Z",
		"end": "2026-05-18T01:00:00Z",
		"step": "60s"
	}`)
	req := httptest.NewRequest(http.MethodPost, "/metrics/series", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer not-a-kubeconfig")
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected batch targets to be rejected before auth, got %d: %s", w.Code, w.Body.String())
	}
	if !bytes.Contains(w.Body.Bytes(), []byte("unexpected property")) || !bytes.Contains(w.Body.Bytes(), []byte("body.targets")) {
		t.Fatalf("expected body.targets schema rejection, got: %s", w.Body.String())
	}
}
