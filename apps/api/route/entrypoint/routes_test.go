package entrypoint

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"

	k8ssvc "sealos/api/service/k8s"
)

func TestRegisterIncludesEntryPointListRoute(t *testing.T) {
	router := chi.NewRouter()
	api := humachi.New(router, huma.DefaultConfig("test", "0.0.0"))

	Register(api)

	path := api.OpenAPI().Paths["/api/entrypoint/v1alpha1/"]
	if path == nil || path.Get == nil {
		t.Fatalf("expected GET /api/entrypoint/v1alpha1/ to be registered")
	}
	if path.Get.OperationID != "entrypoint-get" {
		t.Fatalf("unexpected operation ID: %q", path.Get.OperationID)
	}
}

func TestEntryPointMissingResourceFallbackReturnsEmptyList(t *testing.T) {
	body, ok := emptyListForMissingEntryPointResource(fmt.Errorf(
		"resolve resource: %w",
		k8ssvc.UnknownResourceError{Resource: "entrypoints"},
	))
	if !ok {
		t.Fatal("expected missing entrypoints resource error to use fallback")
	}

	var list struct {
		APIVersion string            `json:"apiVersion"`
		Kind       string            `json:"kind"`
		Items      []json.RawMessage `json:"items"`
	}
	if err := json.Unmarshal(body, &list); err != nil {
		t.Fatalf("fallback body is not valid JSON: %v", err)
	}
	if list.APIVersion != "brain.io/direct" {
		t.Fatalf("apiVersion = %q, want brain.io/direct", list.APIVersion)
	}
	if list.Kind != "EntryPointList" {
		t.Fatalf("kind = %q, want EntryPointList", list.Kind)
	}
	if len(list.Items) != 0 {
		t.Fatalf("items length = %d, want 0", len(list.Items))
	}
}

func TestEntryPointMissingResourceFallbackIgnoresOtherErrors(t *testing.T) {
	if _, ok := emptyListForMissingEntryPointResource(fmt.Errorf("boom")); ok {
		t.Fatal("did not expect generic errors to use EntryPoint empty-list fallback")
	}
}

func TestEntryPointResponseFromIngressesReturnsEntryPointList(t *testing.T) {
	raw := []byte(`{
		"apiVersion": "networking.k8s.io/v1",
		"kind": "IngressList",
		"items": [
			{
				"apiVersion": "networking.k8s.io/v1",
				"kind": "Ingress",
				"metadata": {
					"labels": {
						"brain.io/app-name": "web",
						"brain.io/project-id": "project-a",
						"brain.io/resource-kind": "entrypoint-support"
					},
					"name": "web-pa-abc",
					"namespace": "ns-a"
				},
				"spec": {
					"rules": [{
						"host": "web.example.com",
						"http": {"paths": [{
							"path": "/",
							"pathType": "Prefix",
							"backend": {"service": {"name": "web-service", "port": {"number": 8080}}}
						}]}
					}]
				}
			}
		]
	}`)
	body, err := entryPointResponseFromIngresses(raw, "")
	if err != nil {
		t.Fatalf("entryPointResponseFromIngresses returned error: %v", err)
	}
	var out map[string]interface{}
	if err := json.Unmarshal(body, &out); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	items := out["items"].([]interface{})
	item := items[0].(map[string]interface{})
	spec := item["spec"].(map[string]interface{})
	if got := spec["apRef"]; got != "web" {
		t.Fatalf("spec.apRef = %v, want web", got)
	}
	metadata := item["metadata"].(map[string]interface{})
	if got := metadata["name"]; got != "web" {
		t.Fatalf("metadata.name = %v, want AP-bound name web", got)
	}
}

func TestEntryPointResponseFromIngressesAggregatesByAPName(t *testing.T) {
	raw := []byte(`{
		"apiVersion": "networking.k8s.io/v1",
		"kind": "IngressList",
		"items": [
			{
				"apiVersion": "networking.k8s.io/v1",
				"kind": "Ingress",
				"metadata": {
					"labels": {
						"brain.io/app-name": "web",
						"brain.io/project-id": "project-a",
						"brain.io/public-address-id": "pa_abc",
						"brain.io/public-address-kind": "platform",
						"brain.io/resource-kind": "entrypoint-support"
					},
					"name": "web-pa-abc",
					"namespace": "ns-a"
				},
				"spec": {
					"rules": [{
						"host": "web.example.com",
						"http": {"paths": [{
							"path": "/",
							"pathType": "Prefix",
							"backend": {"service": {"name": "web-service", "port": {"number": 8080}}}
						}]}
					}]
				}
			},
			{
				"apiVersion": "networking.k8s.io/v1",
				"kind": "Ingress",
				"metadata": {
					"labels": {
						"brain.io/app-name": "web",
						"brain.io/project-id": "project-a",
						"brain.io/public-address-id": "cd_def",
						"brain.io/public-address-kind": "custom-domain",
						"brain.io/resource-kind": "entrypoint-support"
					},
					"name": "web-cd-def",
					"namespace": "ns-a"
				},
				"spec": {
					"rules": [{
						"host": "www.example.com",
						"http": {"paths": [{
							"path": "/",
							"pathType": "Prefix",
							"backend": {"service": {"name": "web-service", "port": {"number": 8080}}}
						}]}
					}]
				}
			}
		]
	}`)
	body, err := entryPointResponseFromIngresses(raw, "")
	if err != nil {
		t.Fatalf("entryPointResponseFromIngresses returned error: %v", err)
	}
	var out map[string]interface{}
	if err := json.Unmarshal(body, &out); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	items := out["items"].([]interface{})
	if got := len(items); got != 1 {
		t.Fatalf("items length = %d, want one AP-bound EntryPoint", got)
	}
	item := items[0].(map[string]interface{})
	metadata := item["metadata"].(map[string]interface{})
	if got := metadata["name"]; got != "web" {
		t.Fatalf("metadata.name = %v, want web", got)
	}
	status := item["status"].(map[string]interface{})
	targets := status["targets"].([]interface{})
	if got := len(targets); got != 2 {
		t.Fatalf("targets length = %d, want 2", got)
	}
}

func TestEntryPointResponseFromIngressesReturnsSingleEntryPointByName(t *testing.T) {
	raw := []byte(`{
		"apiVersion": "networking.k8s.io/v1",
		"kind": "IngressList",
		"items": [
			{
				"apiVersion": "networking.k8s.io/v1",
				"kind": "Ingress",
				"metadata": {
					"labels": {
						"brain.io/app-name": "web",
						"brain.io/project-id": "project-a",
						"brain.io/resource-kind": "entrypoint-support"
					},
					"name": "web-pa-abc",
					"namespace": "ns-a"
				},
				"spec": {
					"rules": [{
						"host": "web.example.com",
						"http": {"paths": [{
							"path": "/",
							"pathType": "Prefix",
							"backend": {"service": {"name": "web-service", "port": {"number": 8080}}}
						}]}
					}]
				}
			}
		]
	}`)
	body, err := entryPointResponseFromIngresses(raw, "web")
	if err != nil {
		t.Fatalf("entryPointResponseFromIngresses returned error: %v", err)
	}
	var out map[string]interface{}
	if err := json.Unmarshal(body, &out); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if got := out["kind"]; got != "EntryPoint" {
		t.Fatalf("kind = %v, want EntryPoint", got)
	}
	metadata := out["metadata"].(map[string]interface{})
	if got := metadata["name"]; got != "web" {
		t.Fatalf("metadata.name = %v, want web", got)
	}
}

func TestEntryPointIngressLabelSelectorKeepsBrainOwnership(t *testing.T) {
	got := entryPointIngressLabelSelector("brain.io/project-id=project-a")
	for _, want := range []string{
		"brain.io/managed-by=brain",
		"brain.io/resource-kind=entrypoint-support",
		"brain.io/project-id=project-a",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("selector %q missing %q", got, want)
		}
	}
}
