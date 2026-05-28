package main

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"

	"github.com/MarceloPetrucio/go-scalar-api-reference"
	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/cors"
	"github.com/joho/godotenv"

	"sealos/api/route/ap"
	"sealos/api/route/auth"
	"sealos/api/route/db"
	"sealos/api/route/entrypoint"
	"sealos/api/route/health"
	"sealos/api/route/k8s"
	"sealos/api/route/notif"
	"sealos/api/route/project"
	"sealos/api/route/task"
	"sealos/api/route/telemetry"
)

func main() {
	// Load .env from api directory (works when run from repo root or apps/api)
	if _, err := os.Stat(".env"); err == nil {
		_ = godotenv.Load(".env")
	} else if _, err := os.Stat(filepath.Join("apps", "api", ".env")); err == nil {
		_ = godotenv.Load(filepath.Join("apps", "api", ".env"))
	}
	router := chi.NewMux()
	router.Use(appendSlashForGroupRoots)
	router.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Share-Token"},
		AllowCredentials: false,
		MaxAge:           86400,
	}))

	config := huma.DefaultConfig("Sealos API", "1.0.0")
	config.OpenAPI.Servers = []*huma.Server{
		{URL: "http://localhost:9000", Description: "Test server"},
	}
	config.CreateHooks = nil // Disable $schema in responses and Link header
	config.OnAddOperation = append(config.OnAddOperation, addLogsQueryExamples, addAPCreateExample, addDBCreateExample)
	api := humachi.New(router, config)

	// Health check
	huma.Register(api, huma.Operation{
		OperationID: "health",
		Method:      http.MethodGet,
		Path:        "/health",
		Summary:     "Health check",
		Description: "Returns the service health status. Use this endpoint to verify the API is running and responsive.",
		Tags:        []string{"Health"},
	}, func(ctx context.Context, input *struct{}) (*health.Output, error) {
		resp := &health.Output{}
		resp.Body.Status = "ok"
		return resp, nil
	})

	// Scalar API docs
	router.Get("/docs", docsHandler)

	// Register API routes (with OpenAPI docs)
	k8s.Register(api)
	k8s.RegisterExecWebSocket(router)
	ap.Register(api)
	auth.Register(api)
	project.Register(api)
	db.Register(api)
	entrypoint.Register(api)
	task.Register(api)
	notif.Register(api)
	telemetry.Register(api)

	fmt.Println("Server listening on :9000")
	fmt.Println("API docs: http://localhost:9000/docs")
	if err := http.ListenAndServe(":9000", router); err != nil {
		fmt.Println("Server error:", err)
	}
}

// addAPCreateExample injects a copy-pasteable YAML example for the ap-create (PUT) operation.
func addAPCreateExample(_ *huma.OpenAPI, op *huma.Operation) {
	if op.OperationID != "ap-create" {
		return
	}
	exampleYAML := `apiVersion: example.crossplane.io/v1
kind: AP
metadata:
  name: my-app
spec:
  name: my-app
  input:
    image: nginx:1.27
    network:
      privatePort: 80
    probes:
      startup:
        httpGet:
          path: /
          port: 80
        failureThreshold: 30
      liveness:
        httpGet:
          path: /
          port: 80
        initialDelaySeconds: 15
        failureThreshold: 3
      readiness:
        httpGet:
          path: /
          port: 80
        initialDelaySeconds: 5
        failureThreshold: 3
  resource:
    replicas: 1`
	exampleValue := map[string]any{"yaml": exampleYAML}

	// Set on RequestBody Content (application/json)
	if op.RequestBody != nil && op.RequestBody.Content != nil {
		if mt := op.RequestBody.Content["application/json"]; mt != nil {
			mt.Example = exampleValue
			if mt.Examples == nil {
				mt.Examples = make(map[string]*huma.Example)
			}
			mt.Examples["minimal"] = &huma.Example{
				Summary: "Minimal AP (copy-paste ready)",
				Value:   exampleValue,
			}
		}
	}

	// Also set on Schema.Properties["yaml"] if schema is inline (Scalar may prefer this)
	if op.RequestBody != nil && op.RequestBody.Content != nil {
		if mt := op.RequestBody.Content["application/json"]; mt != nil && mt.Schema != nil && mt.Schema.Properties != nil {
			if yamlProp := mt.Schema.Properties["yaml"]; yamlProp != nil {
				yamlProp.Examples = []any{exampleYAML}
			}
		}
	}
}

// addDBCreateExample injects a copy-pasteable YAML example for the db-create (PUT) operation.
func addDBCreateExample(_ *huma.OpenAPI, op *huma.Operation) {
	if op.OperationID != "db-create" {
		return
	}
	exampleYAML := `apiVersion: example.crossplane.io/v1
kind: DB
metadata:
  name: db-postgresql
  namespace: default
  labels:
    region: 192.168.12.53.nip.io
spec:
  crossplane:
    compositionRef:
      name: dbs-postgresql-kubeblocks-go-templating
  engine: postgresql
  quota: xs`
	exampleValue := map[string]any{"yaml": exampleYAML}

	if op.RequestBody != nil && op.RequestBody.Content != nil {
		if mt := op.RequestBody.Content["application/json"]; mt != nil {
			mt.Example = exampleValue
			if mt.Examples == nil {
				mt.Examples = make(map[string]*huma.Example)
			}
			mt.Examples["minimal"] = &huma.Example{
				Summary: "Minimal DB (copy-paste ready)",
				Value:   exampleValue,
			}
		}
	}
	if op.RequestBody != nil && op.RequestBody.Content != nil {
		if mt := op.RequestBody.Content["application/json"]; mt != nil && mt.Schema != nil && mt.Schema.Properties != nil {
			if yamlProp := mt.Schema.Properties["yaml"]; yamlProp != nil {
				yamlProp.Examples = []any{exampleYAML}
			}
		}
	}
}

// addLogsQueryExamples injects OpenAPI examples for the logs-query operation
// so Scalar and other tools display them in the request/response panels.
func addLogsQueryExamples(_ *huma.OpenAPI, op *huma.Operation) {
	if op.OperationID != "logs-query" {
		return
	}
	// Add request (parameter) examples
	for _, p := range op.Parameters {
		if p == nil {
			continue
		}
		switch p.Name {
		case "namespace":
			p.Examples = map[string]*huma.Example{
				"app-namespace": {Summary: "App namespace", Value: "ns-abc123"},
				"db-namespace":  {Summary: "DB namespace", Value: "ns-j1ifl1cz"},
			}
		case "name":
			p.Examples = map[string]*huma.Example{
				"app-name": {Summary: "App name", Value: "my-app"},
				"db-name":  {Summary: "DB name", Value: "test-db"},
			}
		case "kind":
			p.Examples = map[string]*huma.Example{
				"app": {Summary: "App/launchpad logs", Value: "ap"},
				"db":  {Summary: "Database logs", Value: "db"},
			}
		case "container":
			p.Examples = map[string]*huma.Example{
				"all":        {Summary: "All containers (10 each)", Value: ""},
				"postgresql": {Summary: "PostgreSQL container", Value: "postgresql"},
				"my-app":     {Summary: "App container", Value: "my-app"},
			}
		}
	}
	// Add response examples for Scalar/OpenAPI display
	if op.Responses == nil {
		return
	}
	resp := op.Responses["200"]
	if resp == nil || resp.Content == nil {
		return
	}
	mt := resp.Content["application/json"]
	if mt == nil {
		return
	}
	mt.Examples = map[string]*huma.Example{
		"app-logs-all": {
			Summary: "App logs (all pod+container combinations, 10 each)",
			Value: map[string]any{
				"my-app-abc-123/my-app": []map[string]any{
					{
						"_time":     "2026-03-11T08:36:31.475783223Z",
						"_msg":      "Server started on port 9000",
						"pod":       "my-app-abc-123",
						"container": "my-app",
						"stream":    "stdout",
						"node":      "worker-001",
					},
				},
			},
		},
		"db-logs": {
			Summary: "Database logs (per container)",
			Value: map[string]any{
				"postgresql": []map[string]any{
					{
						"_time":     "2026-03-11T08:36:31.475783223Z",
						"_msg":      "database system is ready to accept connections",
						"pod":       "my-db-postgresql-0",
						"container": "postgresql",
						"stream":    "stdout",
						"node":      "worker-001",
					},
				},
			},
		},
	}
}

// appendSlashForGroupRoots normalises requests so that `/api/ap/v1alpha1` is
// served identically to `/api/ap/v1alpha1/`.
//
// Huma registers group-root operations (Path: "/") under a chi group, which
// yields effective paths with a trailing slash (e.g. `/api/ap/v1alpha1/`).
// Upstream proxies (Next.js) strip trailing slashes before forwarding, so the
// request arrives without one and chi returns 404.  This middleware detects
// those paths and internally appends the slash so chi can match.
func appendSlashForGroupRoots(next http.Handler) http.Handler {
	roots := map[string]bool{
		"/api/ap/v1alpha1":         true,
		"/api/db/v1alpha1":         true,
		"/api/entrypoint/v1alpha1": true,
		"/api/k8s/v1alpha1":        true,
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if roots[r.URL.Path] {
			r2 := new(http.Request)
			*r2 = *r
			r2.URL = new(url.URL)
			*r2.URL = *r.URL
			r2.URL.Path += "/"
			if r2.URL.RawPath != "" {
				r2.URL.RawPath += "/"
			}
			next.ServeHTTP(w, r2)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func docsHandler(w http.ResponseWriter, r *http.Request) {
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	if v := r.Header.Get("X-Forwarded-Proto"); v != "" {
		scheme = v
	}
	specURL := fmt.Sprintf("%s://%s/openapi.json", scheme, r.Host)

	html, err := scalar.ApiReferenceHTML(&scalar.Options{
		SpecURL:  specURL,
		DarkMode: true,
		Layout:   scalar.LayoutModern,
		Theme:    scalar.ThemeDeepSpace,
		CustomOptions: scalar.CustomOptions{
			PageTitle: "Sealos API",
		},
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write([]byte(html))
}
