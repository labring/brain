package db

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"

	dbsvc "sealos/api/service/db"
)

func TestRegisterIncludesAccessHealthRoute(t *testing.T) {
	router := chi.NewRouter()
	api := humachi.New(router, huma.DefaultConfig("test", "0.0.0"))

	Register(api)

	path := api.OpenAPI().Paths["/api/db/v1alpha1/{name}/access/health"]
	if path == nil || path.Post == nil {
		t.Fatalf("expected POST /api/db/v1alpha1/{name}/access/health to be registered")
	}
	if path.Post.OperationID != "db-access-health" {
		t.Fatalf("unexpected operation ID: %q", path.Post.OperationID)
	}
}

func TestRegisterIncludesAccessObjectsRoute(t *testing.T) {
	router := chi.NewRouter()
	api := humachi.New(router, huma.DefaultConfig("test", "0.0.0"))

	Register(api)

	path := api.OpenAPI().Paths["/api/db/v1alpha1/{name}/access/objects"]
	if path == nil || path.Post == nil {
		t.Fatalf("expected POST /api/db/v1alpha1/{name}/access/objects to be registered")
	}
	if path.Post.OperationID != "db-access-objects" {
		t.Fatalf("unexpected operation ID: %q", path.Post.OperationID)
	}
}

func TestRegisterIncludesAccessObjectDetailRoutes(t *testing.T) {
	router := chi.NewRouter()
	api := humachi.New(router, huma.DefaultConfig("test", "0.0.0"))

	Register(api)

	paths := map[string]string{
		"/api/db/v1alpha1/{name}/access/object":  "db-access-object",
		"/api/db/v1alpha1/{name}/access/columns": "db-access-columns",
		"/api/db/v1alpha1/{name}/access/rows":    "db-access-rows",
		"/api/db/v1alpha1/{name}/access/export":  "db-access-export",
	}
	for path, operationID := range paths {
		t.Run(path, func(t *testing.T) {
			got := api.OpenAPI().Paths[path]
			if got == nil || got.Post == nil {
				t.Fatalf("expected POST %s to be registered", path)
			}
			if got.Post.OperationID != operationID {
				t.Fatalf("unexpected operation ID: %q", got.Post.OperationID)
			}
		})
	}
}

func TestRegisterIncludesDBLifecycleRoutes(t *testing.T) {
	router := chi.NewRouter()
	api := humachi.New(router, huma.DefaultConfig("test", "0.0.0"))

	Register(api)

	paths := map[string]string{
		"/api/db/v1alpha1/start":   "db-start",
		"/api/db/v1alpha1/stop":    "db-stop",
		"/api/db/v1alpha1/restart": "db-restart",
	}
	for path, operationID := range paths {
		t.Run(path, func(t *testing.T) {
			got := api.OpenAPI().Paths[path]
			if got == nil || got.Post == nil {
				t.Fatalf("expected POST %s to be registered", path)
			}
			if got.Post.OperationID != operationID {
				t.Fatalf("unexpected operation ID: %q", got.Post.OperationID)
			}
		})
	}
}

func TestDBPatchDocsIncludeLifecycleFields(t *testing.T) {
	router := chi.NewRouter()
	api := humachi.New(router, huma.DefaultConfig("test", "0.0.0"))

	Register(api)

	path := api.OpenAPI().Paths["/api/db/v1alpha1/"]
	if path == nil || path.Patch == nil {
		t.Fatalf("expected PATCH /api/db/v1alpha1/ to be registered")
	}
	description := path.Patch.Description
	for _, want := range []string{"spec.paused", "spec.restartRequest"} {
		if !bytes.Contains([]byte(description), []byte(want)) {
			t.Fatalf("expected patch docs to mention %s, got: %s", want, description)
		}
	}
}

func TestDBOpenAPIDocsDoNotExposeLegacyOwnershipTerms(t *testing.T) {
	router := chi.NewRouter()
	api := humachi.New(router, huma.DefaultConfig("test", "0.0.0"))

	Register(api)

	raw, err := json.Marshal(api.OpenAPI())
	if err != nil {
		t.Fatalf("marshal openapi: %v", err)
	}
	text := string(raw)
	legacyField := "composition" + "Ref"
	legacyGroupVersion := "example." + "cross" + "plane.io/v1"
	for _, forbidden := range []string{
		"metadata.uid",
		"DB claim",
		legacyField,
		legacyGroupVersion,
	} {
		if strings.Contains(text, forbidden) {
			t.Fatalf("DB OpenAPI docs must not contain %q", forbidden)
		}
	}
	if !strings.Contains(text, "projectId") {
		t.Fatalf("DB OpenAPI docs should expose projectId for Brain Project ownership")
	}
}

func TestExposeNodePortPatchValue(t *testing.T) {
	enabled, found := exposeNodePortPatchValue([]byte(`{"spec":{"exposeNodePort":true}}`))
	if !found || !enabled {
		t.Fatalf("expected enabled exposeNodePort patch, got enabled=%v found=%v", enabled, found)
	}
	enabled, found = exposeNodePortPatchValue([]byte(`{"spec":{"exposeNodePort":false}}`))
	if !found || enabled {
		t.Fatalf("expected disabled exposeNodePort patch, got enabled=%v found=%v", enabled, found)
	}
	_, found = exposeNodePortPatchValue([]byte(`{"spec":{"replicas":2}}`))
	if found {
		t.Fatalf("expected exposeNodePort to be absent")
	}
}

func TestKubeBlocksRestartConflictDetection(t *testing.T) {
	err := errors.New(`admission webhook "vopsrequest.kb.io" denied the request: OpsRequest.spec.type=Restart is forbidden when Cluster.status.phase=Creating`)
	if !isKubeBlocksRestartConflict(err) {
		t.Fatal("expected KubeBlocks restart webhook denial to be treated as conflict")
	}
	if isKubeBlocksRestartConflict(errors.New("some other error")) {
		t.Fatal("unexpected conflict detection for unrelated error")
	}
}

func TestDBResponseFromClustersReturnsDBList(t *testing.T) {
	raw := []byte(`{
		"apiVersion": "apps.kubeblocks.io/v1alpha1",
		"kind": "ClusterList",
		"items": [
			{
				"apiVersion": "apps.kubeblocks.io/v1alpha1",
				"kind": "Cluster",
				"metadata": {
					"labels": {
						"brain.io/db-engine": "postgresql",
						"brain.io/project-id": "project-a",
						"brain.io/resource-kind": "db",
						"clusterdefinition.kubeblocks.io/name": "postgresql"
					},
					"name": "pg",
					"namespace": "ns-a"
				},
				"spec": {"clusterDefinitionRef": "postgresql"},
				"status": {"conditions": [{"type": "Ready", "status": "True"}]}
			}
		]
	}`)
	body, err := dbResponseFromClusters(raw, false)
	if err != nil {
		t.Fatalf("dbResponseFromClusters returned error: %v", err)
	}
	var out map[string]interface{}
	if err := json.Unmarshal(body, &out); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	items := out["items"].([]interface{})
	item := items[0].(map[string]interface{})
	if got := item["kind"]; got != "DB" {
		t.Fatalf("item.kind = %v, want DB", got)
	}
	spec := item["spec"].(map[string]interface{})
	if got := spec["engine"]; got != "postgresql" {
		t.Fatalf("spec.engine = %v, want postgresql", got)
	}
}

func TestDBClusterLabelSelectorKeepsBrainOwnership(t *testing.T) {
	got := dbClusterLabelSelector("brain.io/project-id=project-a")
	for _, want := range []string{
		"brain.io/managed-by=brain",
		"brain.io/resource-kind=db",
		"brain.io/project-id=project-a",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("selector %q missing %q", got, want)
		}
	}
}

func TestAccessExportRejectsUnsupportedInputsAtHTTPBoundary(t *testing.T) {
	tests := []struct {
		name         string
		extraPayload string
		location     string
	}{
		{name: "unsupported format", extraPayload: `"format": "excel"`, location: "body.format"},
		{name: "query", extraPayload: `"query": "select * from users"`, location: "body.query"},
		{name: "where", extraPayload: `"where": {"column":"id","op":"=","value":"1"}`, location: "body.where"},
		{name: "selected rows", extraPayload: `"selectedRows": [{"id": 1}]`, location: "body.selectedRows"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			router := chi.NewRouter()
			api := humachi.New(router, huma.DefaultConfig("test", "0.0.0"))
			Register(api)

			body := []byte(fmt.Sprintf(`{
				"projectUid": "project-1",
				"ref": {"kind": "table", "path": ["postgres", "public", "users"]},
				%s
			}`, tt.extraPayload))
			req := httptest.NewRequest(http.MethodPost, "/api/db/v1alpha1/pg-main/access/export", bytes.NewReader(body))
			req.Header.Set("Authorization", "Bearer not-a-kubeconfig")
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()

			router.ServeHTTP(w, req)

			if w.Code != http.StatusUnprocessableEntity {
				t.Fatalf("expected unsupported export input to be rejected before auth, got %d: %s", w.Code, w.Body.String())
			}
			if !bytes.Contains(w.Body.Bytes(), []byte(tt.location)) {
				t.Fatalf("expected schema validation to reference %s, got: %s", tt.location, w.Body.String())
			}
		})
	}
}

func TestAccessRowsRejectsUnsupportedQueryInputsAtHTTPBoundary(t *testing.T) {
	tests := []struct {
		field string
		value string
	}{
		{field: "query", value: `"select * from users"`},
		{field: "where", value: `{"column":"id","op":"=","value":"1"}`},
		{field: "filter", value: `{"column":"id","op":"=","value":"1"}`},
	}

	for _, tt := range tests {
		t.Run(tt.field, func(t *testing.T) {
			router := chi.NewRouter()
			api := humachi.New(router, huma.DefaultConfig("test", "0.0.0"))
			Register(api)

			body := []byte(fmt.Sprintf(`{
				"projectUid": "project-1",
				"ref": {"kind": "table", "path": ["postgres", "public", "users"]},
				"%s": %s
			}`, tt.field, tt.value))
			req := httptest.NewRequest(http.MethodPost, "/api/db/v1alpha1/pg-main/access/rows", bytes.NewReader(body))
			req.Header.Set("Authorization", "Bearer not-a-kubeconfig")
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()

			router.ServeHTTP(w, req)

			if w.Code != http.StatusUnprocessableEntity {
				t.Fatalf("expected unsupported %s input to be rejected before auth, got %d: %s", tt.field, w.Code, w.Body.String())
			}
			location := []byte("body." + tt.field)
			if !bytes.Contains(w.Body.Bytes(), []byte("unexpected property")) || !bytes.Contains(w.Body.Bytes(), location) {
				t.Fatalf("expected schema validation to reject %s, got: %s", location, w.Body.String())
			}
		})
	}
}

func TestAccessHealthErrorStatusMapping(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want int
	}{
		{name: "request validation", err: dbsvc.ErrAccessHealthProjectUID, want: http.StatusBadRequest},
		{name: "ownership mismatch", err: dbsvc.ErrAccessHealthProjectForbidden, want: http.StatusForbidden},
		{name: "missing ownership metadata", err: dbsvc.ErrAccessHealthProjectMissing, want: http.StatusConflict},
		{name: "not ready", err: dbsvc.ErrAccessHealthDBNotReady, want: http.StatusConflict},
		{name: "missing secret", err: dbsvc.ErrAccessHealthSecretMissing, want: http.StatusConflict},
		{name: "unsupported engine", err: dbsvc.ErrAccessHealthUnsupported, want: http.StatusUnprocessableEntity},
		{name: "missing whodb config", err: dbsvc.ErrAccessHealthWhoDBMissing, want: http.StatusServiceUnavailable},
		{name: "unavailable whodb", err: fmt.Errorf("%w: refused", dbsvc.ErrAccessHealthWhoDBUnavailable), want: http.StatusServiceUnavailable},
		{name: "timeout", err: fmt.Errorf("%w: deadline", dbsvc.ErrAccessHealthWhoDBTimeout), want: http.StatusGatewayTimeout},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := accessHealthError(tt.err)
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

func TestAccessObjectsErrorStatusMapping(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want int
	}{
		{name: "request validation", err: dbsvc.ErrAccessHealthProjectUID, want: http.StatusBadRequest},
		{name: "invalid ref", err: dbsvc.ErrAccessObjectsInvalidRef, want: http.StatusUnprocessableEntity},
		{name: "object not found", err: dbsvc.ErrAccessObjectsNotFound, want: http.StatusNotFound},
		{name: "unsupported kind", err: dbsvc.ErrAccessObjectsUnsupportedKind, want: http.StatusUnprocessableEntity},
		{name: "invalid row pagination", err: dbsvc.ErrAccessRowsInvalidPagination, want: http.StatusBadRequest},
		{name: "invalid row sort", err: dbsvc.ErrAccessRowsInvalidSort, want: http.StatusBadRequest},
		{name: "invalid export format", err: dbsvc.ErrAccessExportInvalidFormat, want: http.StatusBadRequest},
		{name: "unsupported engine", err: dbsvc.ErrAccessHealthUnsupported, want: http.StatusUnprocessableEntity},
		{name: "missing whodb config", err: dbsvc.ErrAccessHealthWhoDBMissing, want: http.StatusServiceUnavailable},
		{name: "timeout", err: fmt.Errorf("%w: deadline", dbsvc.ErrAccessHealthWhoDBTimeout), want: http.StatusGatewayTimeout},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := accessObjectsError(tt.err)
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
