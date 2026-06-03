package ap

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
)

func TestAPMutationOpenAPIDocsDescribeDirectKubernetesContract(t *testing.T) {
	router := chi.NewRouter()
	api := humachi.New(router, huma.DefaultConfig("test", "0.0.0"))

	Register(api)

	path := api.OpenAPI().Paths["/api/ap/v1alpha1/"]
	if path == nil || path.Put == nil || path.Patch == nil {
		t.Fatal("expected AP create and update routes to be registered")
	}

	descriptions := map[string]string{
		"create": path.Put.Description,
		"update": path.Patch.Description,
	}
	for name, description := range descriptions {
		t.Run(name, func(t *testing.T) {
			for _, want := range []string{
				"direct Kubernetes",
				"Deployment",
				"spec.input.image",
			} {
				if !strings.Contains(description, want) {
					t.Fatalf("expected %s docs to contain %q, got: %s", name, want, description)
				}
			}
		})
	}

	if !strings.Contains(path.Put.Description, "apiVersion: brain.io/direct") {
		t.Fatalf("expected create docs to contain direct AP manifest example, got: %s", path.Put.Description)
	}
	if strings.Contains(path.Put.Description, "example.crossplane.io/v1") {
		t.Fatalf("AP create docs must not describe the old Crossplane AP API, got: %s", path.Put.Description)
	}
	if !strings.Contains(path.Put.Description, "spec.projectId") {
		t.Fatalf("expected create docs to require spec.projectId, got: %s", path.Put.Description)
	}
	legacyField := "composition" + "Ref"
	if strings.Contains(path.Put.Description+path.Patch.Description, legacyField) {
		t.Fatalf("AP mutation docs must not describe legacy claim API behavior")
	}
}

func TestAPResponseFromDeploymentsReturnsAPList(t *testing.T) {
	raw := []byte(`{
		"apiVersion": "apps/v1",
		"kind": "DeploymentList",
		"items": [
			{
				"apiVersion": "apps/v1",
				"kind": "Deployment",
				"metadata": {
					"labels": {
						"brain.io/project-id": "project-a",
						"brain.io/resource-kind": "ap",
						"cloud.sealos.io/app-deploy-manager": "web"
					},
					"name": "web",
					"namespace": "ns-a"
				},
				"spec": {
					"replicas": 1,
					"selector": {"matchLabels": {"app": "web"}},
					"template": {
						"metadata": {"labels": {"app": "web"}},
						"spec": {"containers": [{"name": "web", "image": "nginx:1.27", "ports": [{"containerPort": 8080}]}]}
					}
				},
				"status": {"replicas": 1, "readyReplicas": 1, "availableReplicas": 1}
			}
		]
	}`)
	body, err := apResponseFromDeployments(raw, false)
	if err != nil {
		t.Fatalf("apResponseFromDeployments returned error: %v", err)
	}
	var out map[string]interface{}
	if err := json.Unmarshal(body, &out); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	items := out["items"].([]interface{})
	item := items[0].(map[string]interface{})
	if got := item["kind"]; got != "AP" {
		t.Fatalf("item.kind = %v, want AP", got)
	}
	spec := item["spec"].(map[string]interface{})
	input := spec["input"].(map[string]interface{})
	if got := input["image"]; got != "nginx:1.27" {
		t.Fatalf("image = %v, want nginx:1.27", got)
	}
}

func TestAPDeploymentLabelSelectorKeepsBrainOwnership(t *testing.T) {
	got := apDeploymentLabelSelector("brain.io/project-id=project-a")
	for _, want := range []string{
		"brain.io/managed-by=brain",
		"brain.io/resource-kind=ap",
		"brain.io/project-id=project-a",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("selector %q missing %q", got, want)
		}
	}
}

func TestAPDeploymentPatchFromProductPatch(t *testing.T) {
	raw := json.RawMessage(`{"spec":{"paused":true,"input":{"image":"nginx:1.28"},"resource":{"replicas":3}}}`)
	patch := apDeploymentPatchFromProductPatch(raw, "web")
	var out map[string]interface{}
	if err := json.Unmarshal(patch, &out); err != nil {
		t.Fatalf("unmarshal patch: %v", err)
	}
	spec := out["spec"].(map[string]interface{})
	if got := spec["replicas"]; got != float64(0) {
		t.Fatalf("replicas = %v, want 0", got)
	}
	metadata := spec["metadata"].(map[string]interface{})
	annotations := metadata["annotations"].(map[string]interface{})
	if got := annotations["deploy.cloud.sealos.io/pause"]; got != "true" {
		t.Fatalf("pause annotation = %v, want true", got)
	}
	template := spec["template"].(map[string]interface{})
	templateSpec := template["spec"].(map[string]interface{})
	containers := templateSpec["containers"].([]interface{})
	container := containers[0].(map[string]interface{})
	if got := container["image"]; got != "nginx:1.28" {
		t.Fatalf("image = %v, want nginx:1.28", got)
	}
}
