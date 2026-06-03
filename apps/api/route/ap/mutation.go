package ap

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/danielgtaylor/huma/v2"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
	"sigs.k8s.io/yaml"

	"sealos/api/middleware"
	k8ssvc "sealos/api/service/k8s"
	orchestration "sealos/api/service/orchestration"
)

func registerCreate(grp huma.API) {
	type createBody struct {
		YAML string `json:"yaml" required:"true" doc:"AP product manifest (YAML or JSON). The Go API renders it directly into Kubernetes Deployment and Service resources. Required fields: metadata.name, spec.projectId, spec.input.image, and spec.input.network.privatePort."`
	}
	type createInput struct {
		middleware.AuthInput
		Body createBody
	}
	type createOutput struct {
		Body struct {
			YAML string `json:"yaml" doc:"The created AP resource in YAML format (server state after apply)."`
		}
	}

	exampleYAML := `apiVersion: brain.io/direct
kind: AP
metadata:
  name: my-app
spec:
  name: my-app
  projectId: project-id
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
    replicaStrategy:
      type: fixed
      fixed:
        replicas: 1
    requests:
      cpu: 200m
      memory: 204Mi
    limits:
      cpu: 2000m
      memory: 2048Mi`

	huma.Register(grp, huma.Operation{
		OperationID: "ap-create",
		Method:      http.MethodPut,
		Path:        "/",
		Summary:     "Create or replace AP",
		Description: "Create an AP instance from one Brain AP product manifest (PUT). The Go API renders direct Kubernetes Deployment and Service resources and returns the AP product view as YAML.\n\n" +
			"**Request body usage:**\n" +
			"- Send exactly one AP manifest in the `yaml` field.\n" +
			"- Required fields are `metadata.name`, `spec.projectId`, `spec.input.image`, and `spec.input.network.privatePort`.\n\n" +
			"**Response:** Returns the created AP product view in YAML format.\n\n" +
			"**Copy-pasteable example (use in `yaml` field):**\n```yaml\n" + exampleYAML + "\n```",
		Tags: []string{"AP"},
	}, func(ctx context.Context, input *createInput) (*createOutput, error) {
		restConfig, cfg, err := middleware.RestConfigFromAuth(input.Authorization)
		if err != nil {
			return nil, huma.Error400BadRequest("invalid kubeconfig", err)
		}
		if input.Body.YAML == "" {
			return nil, huma.Error400BadRequest("body.yaml is required", nil)
		}

		var obj unstructured.Unstructured
		if err := yaml.Unmarshal([]byte(input.Body.YAML), &obj.Object); err != nil {
			return nil, huma.Error400BadRequest("invalid YAML", err)
		}
		name := obj.GetName()
		if name == "" {
			return nil, huma.Error400BadRequest("metadata.name is required", nil)
		}
		ns := obj.GetNamespace()
		if ns == "" {
			gvr := middleware.PodsGVR()
			resolved, err := middleware.ResolveContext(cfg, middleware.ResolveOptions{
				Namespace:        "",
				AllNamespaces:    false,
				DefaultNamespace: "default",
				AdminCheckGVR:    &gvr,
			})
			if err != nil {
				return nil, huma.Error500InternalServerError("failed to resolve namespace", err)
			}
			ns = resolved.Namespace
			if ns == "" {
				ns = "default"
			}
			obj.SetNamespace(ns)
			yamlBytes, _ := yaml.Marshal(obj.Object)
			input.Body.YAML = string(yamlBytes)
		}

		renderInput := apRenderInputFromObject(obj, ns)
		resources, err := orchestration.RenderAPResources(renderInput)
		if err != nil {
			return nil, huma.Error400BadRequest("invalid AP direct resource request", err)
		}
		if err := k8ssvc.ApplyObjects(restConfig, []runtime.Object{resources.Deployment, resources.Service}, ns); err != nil {
			return nil, huma.Error500InternalServerError("failed to create AP", err)
		}

		jsonBytes, err := k8ssvc.Get(cfg, k8ssvc.GetOptions{
			Resource:      "deployments",
			Name:          name,
			Namespace:     ns,
			LabelSelector: orchestration.BrainManagedByLabel + "=" + orchestration.BrainManagedByValue + "," + orchestration.BrainResourceKindLabel + "=" + orchestration.ResourceKindAP,
		})
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to get created AP", err)
		}

		body, err := apResponseFromDeployments(jsonBytes, true)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to adapt created AP", err)
		}
		var created map[string]interface{}
		if err := json.Unmarshal(body, &created); err != nil {
			return nil, huma.Error500InternalServerError("failed to marshal created AP", err)
		}
		yamlBytes, err := yaml.Marshal(created)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to marshal created AP to YAML", err)
		}
		out := createOutput{}
		out.Body.YAML = string(yamlBytes)
		return &out, nil
	})
}

func apRenderInputFromObject(obj unstructured.Unstructured, namespace string) orchestration.APResourcesInput {
	spec, _ := obj.Object["spec"].(map[string]interface{})
	input, _ := spec["input"].(map[string]interface{})
	network, _ := input["network"].(map[string]interface{})
	resourceSpec, _ := spec["resource"].(map[string]interface{})
	projectID := stringFromMap(spec, "projectId")
	if projectID == "" {
		projectID = stringFromMap(spec, "projectID")
	}
	return orchestration.APResourcesInput{
		Image:       stringFromMap(input, "image"),
		Name:        obj.GetName(),
		Namespace:   namespace,
		PrivatePort: int32FromMap(network, "privatePort"),
		ProjectID:   projectID,
		Replicas:    int32FromMap(resourceSpec, "replicas"),
	}
}

func stringFromMap(values map[string]interface{}, key string) string {
	if values == nil {
		return ""
	}
	value, _ := values[key].(string)
	return strings.TrimSpace(value)
}

func int32FromMap(values map[string]interface{}, key string) int32 {
	if values == nil {
		return 0
	}
	switch value := values[key].(type) {
	case int:
		return int32(value)
	case int32:
		return value
	case int64:
		return int32(value)
	case float64:
		return int32(value)
	default:
		return 0
	}
}

func registerUpdate(grp huma.API) {
	type updateInput struct {
		middleware.AuthInput
		Name      string          `query:"name" required:"true" doc:"AP instance name to patch"`
		Namespace string          `query:"namespace" doc:"Namespace (default from kubeconfig; admin can override)"`
		Body      json.RawMessage `contentType:"application/json" required:"true" doc:"JSON merge patch body applied to the AP resource.\n\nWhat to patch:\n- spec.input.image: update the application image.\n- spec.input.network.privatePort: update the App Listening Port targeted by the Private Address.\n- spec.input.network.platformAddresses: replace Public Address requests as one coherent Network object.\n- spec.input.network.customDomains: replace Custom Domain Binding requests as part of the coherent Network object.\n- spec.resource.replicaStrategy.type: fixed or elastic AP replica behavior.\n- spec.resource.replicaStrategy.fixed.replicas: Fixed Replicas count, 1-20.\n- spec.resource.replicaStrategy.elastic: Elastic Scaling with minReplicas, maxReplicas, and one CPU utilization or Memory average value target.\n- Legacy spec.resource.replicas remains accepted as a Fixed Replicas fallback when replicaStrategy is absent.\n- spec.paused: when true, scale the Deployment to 0 with SealOS pause annotations; false resumes using the active Fixed Replicas value.\n- spec.restartRequest: bump this integer to roll pods via Composition (alternative: POST .../restart on the Deployment).\n- spec.input.env: replace the full environment variable list.\n- spec.input.probes: replace health probes (startup, liveness, readiness).\n- spec.resource.requests / spec.resource.limits: container resources.\n- spec.ingressAnnotations: add or replace Ingress annotations.\n\nPatch examples:\n- Pause: {\"spec\":{\"paused\":true}}\n- Resume: {\"spec\":{\"paused\":false}}\n- Update image: {\"spec\":{\"input\":{\"image\":\"nginx:1.27\"}}}\n- Change Private Address target port: {\"spec\":{\"input\":{\"network\":{\"privatePort\":8080}}}}\n- Replace Network with one Public Address: {\"spec\":{\"input\":{\"network\":{\"privatePort\":8080,\"platformAddresses\":[{\"id\":\"pa_abc123\",\"port\":8080}]}}}}\n- Change Fixed Replicas: {\"spec\":{\"resource\":{\"replicaStrategy\":{\"type\":\"fixed\",\"fixed\":{\"replicas\":2}}}}}\n- Change CPU Elastic Scaling: {\"spec\":{\"resource\":{\"replicaStrategy\":{\"type\":\"elastic\",\"elastic\":{\"minReplicas\":2,\"maxReplicas\":8,\"target\":{\"metric\":\"cpu\",\"type\":\"utilization\",\"utilizationPercent\":75}}}}}}\n- Change Memory Elastic Scaling: {\"spec\":{\"resource\":{\"replicaStrategy\":{\"type\":\"elastic\",\"elastic\":{\"minReplicas\":2,\"maxReplicas\":8,\"target\":{\"metric\":\"memory\",\"type\":\"averageValue\",\"averageValue\":\"512Mi\"}}}}}}\n\nPatch semantics:\n- Only the fields you send are changed.\n- Nested objects merge at the subtree you provide.\n- Arrays such as spec.input.network.platformAddresses, spec.input.network.customDomains, and spec.input.env are replaced as whole lists."`
	}
	type updateOutput struct {
		Body json.RawMessage
	}

	huma.Register(grp, huma.Operation{
		OperationID: "ap-update",
		Method:      http.MethodPatch,
		Path:        "/",
		Summary:     "Update AP",
		Description: "Patch an AP instance by name. The Go API translates supported AP product patch fields into direct Kubernetes Deployment updates. Supported patch targets include `spec.input.image`, `spec.resource.replicas`, and `spec.paused`.",
		Tags:        []string{"AP"},
	}, func(ctx context.Context, input *updateInput) (*updateOutput, error) {
		_, cfg, err := middleware.RestConfigFromAuth(input.Authorization)
		if err != nil {
			return nil, huma.Error400BadRequest("invalid kubeconfig", err)
		}
		if input.Name == "" {
			return nil, huma.Error400BadRequest("name is required", nil)
		}
		if len(input.Body) == 0 {
			return nil, huma.Error400BadRequest("patch body is required", nil)
		}

		gvr := middleware.PodsGVR()
		resolved, err := middleware.ResolveContext(cfg, middleware.ResolveOptions{
			Namespace:        input.Namespace,
			AllNamespaces:    false,
			DefaultNamespace: "",
			AdminCheckGVR:    &gvr,
		})
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to resolve request context", err)
		}

		jsonBytes, err := k8ssvc.Patch(cfg, k8ssvc.PatchOptions{
			Resource:  "deployments",
			Name:      input.Name,
			Namespace: resolved.Namespace,
			PatchType: k8ssvc.PatchTypeStrategic,
			Patch:     apDeploymentPatchFromProductPatch(input.Body, input.Name),
		})
		if err != nil {
			if apierrors.IsNotFound(err) {
				return nil, huma.Error404NotFound("AP not found", err)
			}
			return nil, huma.Error500InternalServerError("failed to update AP", err)
		}
		body, err := apResponseFromDeployments(jsonBytes, true)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to adapt AP response", err)
		}
		return &updateOutput{Body: body}, nil
	})
}

func apDeploymentPatchFromProductPatch(raw json.RawMessage, name string) []byte {
	var patch map[string]interface{}
	if err := json.Unmarshal(raw, &patch); err != nil {
		return raw
	}
	spec, _ := patch["spec"].(map[string]interface{})
	deploymentPatch := map[string]interface{}{}
	templatePatch := map[string]interface{}{}
	metadataPatch := map[string]interface{}{}
	annotationsPatch := map[string]interface{}{}
	paused := false
	hasPaused := false

	if value, ok := spec["paused"].(bool); ok {
		paused = value
		hasPaused = true
		annotationsPatch[orchestration.LaunchpadPauseAnnotation] = map[bool]string{true: "true", false: "false"}[paused]
		if paused {
			deploymentPatch["replicas"] = 0
		} else {
			deploymentPatch["replicas"] = 1
		}
	}
	if input, _ := spec["input"].(map[string]interface{}); input != nil {
		containerPatch := map[string]interface{}{"name": name}
		if image := stringFromMap(input, "image"); image != "" {
			containerPatch["image"] = image
		}
		if len(containerPatch) > 1 {
			templatePatch["spec"] = map[string]interface{}{
				"containers": []interface{}{containerPatch},
			}
		}
	}
	if resourceSpec, _ := spec["resource"].(map[string]interface{}); resourceSpec != nil {
		if replicas := int32FromMap(resourceSpec, "replicas"); replicas > 0 && !(hasPaused && paused) {
			deploymentPatch["replicas"] = replicas
		}
	}
	if len(annotationsPatch) > 0 {
		metadataPatch["annotations"] = annotationsPatch
	}
	if len(metadataPatch) > 0 {
		deploymentPatch["metadata"] = metadataPatch
	}
	if len(templatePatch) > 0 {
		deploymentPatch["template"] = templatePatch
	}
	out := map[string]interface{}{"spec": deploymentPatch}
	bytes, err := json.Marshal(out)
	if err != nil {
		return raw
	}
	return bytes
}

func registerDelete(grp huma.API) {
	type deleteInput struct {
		middleware.AuthInput
		Name      string `query:"name" required:"true" doc:"AP instance name to delete"`
		Namespace string `query:"namespace" doc:"Namespace (default from kubeconfig; admin can override)"`
	}
	type deleteOutput struct {
		Body struct {
			Status string `json:"status"`
		}
	}

	huma.Register(grp, huma.Operation{
		OperationID: "ap-delete",
		Method:      http.MethodDelete,
		Path:        "/",
		Summary:     "Delete AP",
		Description: "Delete an AP instance by name.\n\nParameter usage:\n- `name` is required and selects the AP to delete.\n- `namespace` is optional; admins can override the namespace from kubeconfig.\n\nBehavior:\n- The Go API explicitly deletes Brain-managed public routing support resources, private Service, and Deployment using brain.io labels.",
		Tags:        []string{"AP"},
	}, func(ctx context.Context, input *deleteInput) (*deleteOutput, error) {
		_, cfg, err := middleware.RestConfigFromAuth(input.Authorization)
		if err != nil {
			return nil, huma.Error400BadRequest("invalid kubeconfig", err)
		}
		if input.Name == "" {
			return nil, huma.Error400BadRequest("name is required", nil)
		}

		gvr := middleware.PodsGVR()
		resolved, err := middleware.ResolveContext(cfg, middleware.ResolveOptions{
			Namespace:        input.Namespace,
			AllNamespaces:    false,
			DefaultNamespace: "",
			AdminCheckGVR:    &gvr,
		})
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to resolve request context", err)
		}

		if err := deleteAPDirectResources(cfg, input.Name, resolved.Namespace); err != nil {
			if apierrors.IsNotFound(err) {
				return nil, huma.Error404NotFound("AP not found", err)
			}
			return nil, huma.Error500InternalServerError("failed to delete AP", err)
		}
		return &deleteOutput{
			Body: struct {
				Status string `json:"status"`
			}{
				Status: "deleted",
			},
		}, nil
	})
}

func deleteAPDirectResources(clientCfg *clientcmdapi.Config, name string, namespace string) error {
	selector := orchestration.BrainManagedByLabel + "=" + orchestration.BrainManagedByValue + "," + orchestration.BrainAppNameLabel + "=" + name
	for _, resource := range []string{"certificates", "issuers", "ingresses", "horizontalpodautoscalers", "services", "configmaps", "secrets"} {
		_, err := k8ssvc.Delete(clientCfg, k8ssvc.DeleteOptions{
			LabelSelector: selector,
			Namespace:     namespace,
			Resource:      resource,
		})
		if err != nil && !apierrors.IsNotFound(err) && !k8ssvc.IsUnknownResourceError(err, resource) {
			return err
		}
	}
	_, err := k8ssvc.Delete(clientCfg, k8ssvc.DeleteOptions{
		Name:      name,
		Namespace: namespace,
		Resource:  "deployments",
	})
	if err != nil && apierrors.IsNotFound(err) {
		return nil
	}
	return err
}

// Composed Deployment name matches the AP (metadata.name); see
// aps-deployment-ingress-go-templating (Deployment metadata.name: {{ $name }}).

func registerRestart(grp huma.API) {
	type restartBody struct {
		Name      string `json:"name" required:"true" doc:"AP claim metadata.name; the composed Deployment uses the same name in the same namespace."`
		Namespace string `json:"namespace" doc:"Namespace of the AP (default from kubeconfig; admin can override)."`
	}
	type restartInput struct {
		middleware.AuthInput
		Body restartBody
	}
	type restartOutput struct {
		Body json.RawMessage
	}

	huma.Register(grp, huma.Operation{
		OperationID: "ap-restart",
		Method:      http.MethodPost,
		Path:        "/restart",
		Summary:     "Restart AP workload (rollout restart Deployment)",
		Description: "Rollout-restarts the underlying Deployment for an AP (e.g. composition `aps-deployment-ingress-go-templating`): " +
			"the Deployment is named like the AP (`metadata.name`) in the same namespace. " +
			"Equivalent to `kubectl rollout restart deployment/<name>`.",
		Tags: []string{"AP"},
	}, func(ctx context.Context, input *restartInput) (*restartOutput, error) {
		_, cfg, err := middleware.RestConfigFromAuth(input.Authorization)
		if err != nil {
			return nil, huma.Error400BadRequest("invalid kubeconfig", err)
		}
		name := strings.TrimSpace(input.Body.Name)
		if name == "" {
			return nil, huma.Error400BadRequest("name is required", nil)
		}

		gvr := middleware.PodsGVR()
		resolved, err := middleware.ResolveContext(cfg, middleware.ResolveOptions{
			Namespace:        input.Body.Namespace,
			AllNamespaces:    false,
			DefaultNamespace: "",
			AdminCheckGVR:    &gvr,
		})
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to resolve request context", err)
		}

		jsonBytes, err := k8ssvc.RolloutRestart(cfg, k8ssvc.RolloutOptions{
			Resource:  "deployment",
			Name:      name,
			Namespace: resolved.Namespace,
		})
		if err != nil {
			if apierrors.IsNotFound(err) {
				return nil, huma.Error404NotFound("deployment for AP not found in namespace (expected same name as the AP claim)", err)
			}
			return nil, huma.Error500InternalServerError("failed to restart deployment", err)
		}
		return &restartOutput{Body: json.RawMessage(jsonBytes)}, nil
	})
}
