package ap

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/danielgtaylor/huma/v2"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/rest"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
	"sigs.k8s.io/yaml"

	"sealos/api/middleware"
	"sealos/api/service/apversion"
	k8ssvc "sealos/api/service/k8s"
	orchestration "sealos/api/service/orchestration"
)

func registerCreate(grp huma.API) {
	type createBody struct {
		YAML string `json:"yaml" required:"true" doc:"AP product manifest (YAML or JSON). The Go API renders it directly into Kubernetes Deployment and Service resources. Required fields: metadata.name, spec.projectId, spec.input.image, and spec.input.network.appListeningPorts."`
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
      appListeningPorts:
        - port: 80
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
			"- Required fields are `metadata.name`, `spec.projectId`, `spec.input.image`, and `spec.input.network.appListeningPorts`.\n\n" +
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
		}
		normalizeAPPublicNetworkIntent(&obj, ns)
		yamlBytes, _ := yaml.Marshal(obj.Object)
		input.Body.YAML = string(yamlBytes)
		if err := ensureAPCreateTargetIsBrainManaged(cfg, name, ns); err != nil {
			return nil, huma.Error409Conflict("AP name conflicts with a non-Brain Deployment", err)
		}

		renderInput := apRenderInputFromObject(obj, ns)
		resources, err := orchestration.RenderAPResources(renderInput)
		if err != nil {
			return nil, huma.Error400BadRequest("invalid AP direct resource request", err)
		}
		objects := []runtime.Object{resources.Deployment, resources.Service}
		if resources.HPA != nil {
			objects = append(objects, resources.HPA)
		}
		ingresses, err := apPublicIngressesFromObject(obj, ns)
		if err != nil {
			return nil, huma.Error400BadRequest("invalid AP public network request", err)
		}
		for _, ingress := range ingresses {
			objects = append(objects, ingress)
		}
		if err := k8ssvc.ApplyObjects(restConfig, objects, ns); err != nil {
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
		body, err = recordAPImageVersionSideEffect(ctx, body, "create", recordAPImageVersion)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to annotate AP image version warning", err)
		}
		if err := json.Unmarshal(body, &created); err != nil {
			return nil, huma.Error500InternalServerError("failed to decode created AP warning", err)
		}
		yamlBytes, err = yaml.Marshal(created)
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
	appListeningPorts := apAppListeningPortsFromNetwork(network)
	privatePort := int32FromMap(network, "privatePort")
	if privatePort <= 0 && len(appListeningPorts) > 0 {
		privatePort = appListeningPorts[0].Port
	}
	return orchestration.APResourcesInput{
		Env:             envVarsFromValue(input["env"]),
		EnvRawSource:    stringFromMap(input, "envRawSource"),
		Image:           stringFromMap(input, "image"),
		ImagePullPolicy: corev1.PullPolicy(stringFromMap(input, "imagePullPolicy")),
		LivenessProbe:   probeFromInput(input, "liveness"),
		Name:            obj.GetName(),
		NetworkJSON:     networkJSONFromMap(network),
		Namespace:       namespace,
		PrivatePort:     privatePort,
		ProjectID:       projectID,
		ReadinessProbe:  probeFromInput(input, "readiness"),
		Replicas:        apReplicasFromResourceSpec(resourceSpec),
		ResourceLimit:   resourceListFromMap(resourceSpec, "limits"),
		ResourceReq:     resourceListFromMap(resourceSpec, "requests"),
		ReplicaStrategy: apReplicaStrategyFromResourceSpec(resourceSpec),
		RoutingDomain:   routingDomainFromObject(obj),
		StartupProbe:    probeFromInput(input, "startup"),
	}
}

func routingDomainFromObject(obj unstructured.Unstructured) string {
	return strings.TrimSpace(obj.GetLabels()[orchestration.APRoutingDomainLabel])
}

func requireBrainAPDeployment(deployment appsv1.Deployment) error {
	labels := deployment.GetLabels()
	if labels[orchestration.BrainManagedByLabel] != orchestration.BrainManagedByValue ||
		labels[orchestration.BrainResourceKindLabel] != orchestration.ResourceKindAP ||
		strings.TrimSpace(labels[orchestration.BrainProjectIDLabel]) == "" {
		return errors.New("deployment is not a Brain-managed AP")
	}
	return nil
}

func ensureAPCreateTargetIsBrainManaged(cfg *clientcmdapi.Config, name string, namespace string) error {
	currentJSON, err := k8ssvc.Get(cfg, k8ssvc.GetOptions{
		Resource:  "deployments",
		Name:      name,
		Namespace: namespace,
	})
	if apierrors.IsNotFound(err) {
		return nil
	}
	if err != nil {
		return err
	}
	var current appsv1.Deployment
	if err := json.Unmarshal(currentJSON, &current); err != nil {
		return err
	}
	return requireBrainAPDeployment(current)
}

func networkJSONFromMap(network map[string]interface{}) string {
	if network == nil {
		return ""
	}
	bytes, err := json.Marshal(network)
	if err != nil {
		return ""
	}
	return string(bytes)
}

func apPublicIngressesFromObject(obj unstructured.Unstructured, namespace string) ([]runtime.Object, error) {
	spec, _ := obj.Object["spec"].(map[string]interface{})
	input, _ := spec["input"].(map[string]interface{})
	network, _ := input["network"].(map[string]interface{})
	projectID := stringFromMap(spec, "projectId")
	if projectID == "" {
		projectID = stringFromMap(spec, "projectID")
	}
	return orchestration.RenderAPPublicRoutingResources(orchestration.APNetworkIngressInput{
		APName:            obj.GetName(),
		AppListeningPorts: apAppListeningPortsFromNetwork(network),
		CustomDomains:     apCustomDomainsFromNetwork(network),
		Namespace:         namespace,
		PlatformAddresses: apPlatformAddressesFromNetwork(network),
		ProjectID:         projectID,
		RoutingDomain:     routingDomainFromObject(obj),
	})
}

func apAppListeningPortsFromNetwork(network map[string]interface{}) []orchestration.APAppListeningPort {
	ports, err := orchestration.NormalizeAPAppListeningPortsFromNetwork(network, 0)
	if err != nil {
		return nil
	}
	return ports
}

func apPlatformAddressesFromNetwork(network map[string]interface{}) []orchestration.APPlatformAddressRequest {
	rows, ok := network["platformAddresses"].([]interface{})
	if !ok || len(rows) == 0 {
		return nil
	}
	out := make([]orchestration.APPlatformAddressRequest, 0, len(rows))
	for _, row := range rows {
		item, _ := row.(map[string]interface{})
		if item == nil {
			continue
		}
		id := stringFromMap(item, "id")
		port := int32FromMap(item, "port")
		if id == "" {
			continue
		}
		out = append(out, orchestration.APPlatformAddressRequest{
			DomainPrefix: stringFromMap(item, "domainPrefix"),
			ID:           id,
			Port:         port,
		})
	}
	return out
}

func normalizeAPPublicNetworkIntent(obj *unstructured.Unstructured, namespace string) {
	spec, _ := obj.Object["spec"].(map[string]interface{})
	input, _ := spec["input"].(map[string]interface{})
	network, _ := input["network"].(map[string]interface{})
	rows, _ := network["platformAddresses"].([]interface{})
	if len(rows) == 0 {
		return
	}
	for _, row := range rows {
		item, _ := row.(map[string]interface{})
		if item == nil {
			continue
		}
		id := stringFromMap(item, "id")
		if id == "" {
			continue
		}
		prefix := orchestration.APPlatformAddressDomainPrefix(namespace, obj.GetName(), id, stringFromMap(item, "domainPrefix"))
		if prefix != "" {
			item["domainPrefix"] = prefix
		}
	}
}

func apCustomDomainsFromNetwork(network map[string]interface{}) []orchestration.APCustomDomainRequest {
	rows, ok := network["customDomains"].([]interface{})
	if !ok || len(rows) == 0 {
		return nil
	}
	out := make([]orchestration.APCustomDomainRequest, 0, len(rows))
	for _, row := range rows {
		item, _ := row.(map[string]interface{})
		if item == nil {
			continue
		}
		id := stringFromMap(item, "id")
		domain := stringFromMap(item, "domain")
		platformAddressID := stringFromMap(item, "platformAddressId")
		if id == "" || domain == "" || platformAddressID == "" {
			continue
		}
		out = append(out, orchestration.APCustomDomainRequest{
			Domain:            domain,
			ID:                id,
			PlatformAddressID: platformAddressID,
		})
	}
	return out
}

func envVarsFromValue(value interface{}) []corev1.EnvVar {
	rows, ok := value.([]interface{})
	if !ok || len(rows) == 0 {
		return nil
	}
	out := make([]corev1.EnvVar, 0, len(rows))
	for _, row := range rows {
		item, _ := row.(map[string]interface{})
		if item == nil {
			continue
		}
		name := stringFromMap(item, "name")
		if name == "" {
			continue
		}
		env := corev1.EnvVar{Name: name, Value: stringFromMap(item, "value")}
		if valueFrom, _ := item["valueFrom"].(map[string]interface{}); valueFrom != nil {
			var source corev1.EnvVarSource
			if err := runtime.DefaultUnstructuredConverter.FromUnstructured(valueFrom, &source); err == nil {
				env.ValueFrom = &source
				env.Value = ""
			}
		}
		out = append(out, env)
	}
	return out
}

func probeFromInput(input map[string]interface{}, key string) *corev1.Probe {
	probes, _ := input["probes"].(map[string]interface{})
	if probes == nil {
		return nil
	}
	value, _ := probes[key].(map[string]interface{})
	if value == nil {
		return nil
	}
	var probe corev1.Probe
	if err := runtime.DefaultUnstructuredConverter.FromUnstructured(value, &probe); err != nil {
		return nil
	}
	return &probe
}

func resourceListFromMap(values map[string]interface{}, key string) corev1.ResourceList {
	items, _ := values[key].(map[string]interface{})
	if len(items) == 0 {
		return nil
	}
	out := corev1.ResourceList{}
	for name, raw := range items {
		value := strings.TrimSpace(toString(raw))
		if value == "" {
			continue
		}
		quantity, err := resource.ParseQuantity(value)
		if err != nil {
			continue
		}
		out[corev1.ResourceName(name)] = quantity
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func toString(value interface{}) string {
	switch v := value.(type) {
	case string:
		return v
	case json.Number:
		return v.String()
	case int:
		return strconv.Itoa(v)
	case int32:
		return strconv.FormatInt(int64(v), 10)
	case int64:
		return strconv.FormatInt(v, 10)
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	default:
		return ""
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
	case json.Number:
		n, err := value.Int64()
		if err == nil {
			return int32(n)
		}
	case string:
		n, err := strconv.ParseInt(strings.TrimSpace(value), 10, 32)
		if err == nil {
			return int32(n)
		}
	default:
		return 0
	}
	return 0
}

func registerUpdate(grp huma.API) {
	type updateInput struct {
		middleware.AuthInput
		Name      string          `query:"name" required:"true" doc:"AP instance name to patch"`
		Namespace string          `query:"namespace" doc:"Namespace (default from kubeconfig; admin can override)"`
		Body      json.RawMessage `contentType:"application/json" required:"true" doc:"JSON merge patch body applied to the AP resource.\n\nWhat to patch:\n- spec.input.image: update the application image.\n- spec.input.network.appListeningPorts: replace App Listening Ports as one coherent Network object.\n- spec.input.network.platformAddresses: replace Public Address requests as one coherent Network object.\n- spec.input.network.customDomains: replace Custom Domain Binding requests as part of the coherent Network object.\n- Legacy spec.input.network.privatePort remains readable as a one-port fallback.\n- spec.resource.replicaStrategy.type: fixed or elastic AP replica behavior.\n- spec.resource.replicaStrategy.fixed.replicas: Fixed Replicas count, 1-20.\n- spec.resource.replicaStrategy.elastic: Elastic Scaling with minReplicas, maxReplicas, and one CPU utilization or Memory average value target.\n- Legacy spec.resource.replicas remains accepted as a Fixed Replicas fallback when replicaStrategy is absent.\n- spec.paused: when true, scale the Deployment to 0 with SealOS pause annotations; false resumes using the active Fixed Replicas value.\n- spec.restartRequest: bump this integer to request a rollout (alternative: POST .../restart on the Deployment).\n- spec.input.env: replace the full environment variable list.\n- spec.input.probes: replace health probes (startup, liveness, readiness).\n- spec.resource.requests / spec.resource.limits: container resources.\n- spec.ingressAnnotations: add or replace Ingress annotations.\n\nPatch examples:\n- Pause: {\"spec\":{\"paused\":true}}\n- Resume: {\"spec\":{\"paused\":false}}\n- Update image: {\"spec\":{\"input\":{\"image\":\"nginx:1.27\"}}}\n- Replace App Listening Ports: {\"spec\":{\"input\":{\"network\":{\"appListeningPorts\":[{\"port\":80},{\"port\":3000}]}}}}\n- Replace Network with one Public Address: {\"spec\":{\"input\":{\"network\":{\"appListeningPorts\":[{\"port\":8080}],\"platformAddresses\":[{\"id\":\"pa_abc123\",\"port\":8080}]}}}}\n- Change Fixed Replicas: {\"spec\":{\"resource\":{\"replicaStrategy\":{\"type\":\"fixed\",\"fixed\":{\"replicas\":2}}}}}\n- Change CPU Elastic Scaling: {\"spec\":{\"resource\":{\"replicaStrategy\":{\"type\":\"elastic\",\"elastic\":{\"minReplicas\":2,\"maxReplicas\":8,\"target\":{\"metric\":\"cpu\",\"type\":\"utilization\",\"utilizationPercent\":75}}}}}}\n- Change Memory Elastic Scaling: {\"spec\":{\"resource\":{\"replicaStrategy\":{\"type\":\"elastic\",\"elastic\":{\"minReplicas\":2,\"maxReplicas\":8,\"target\":{\"metric\":\"memory\",\"type\":\"averageValue\",\"averageValue\":\"512Mi\"}}}}}}\n\nPatch semantics:\n- Only the fields you send are changed.\n- Nested objects merge at the subtree you provide.\n- Arrays such as spec.input.network.appListeningPorts, spec.input.network.platformAddresses, spec.input.network.customDomains, and spec.input.env are replaced as whole lists."`
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
		restConfig, cfg, err := middleware.RestConfigFromAuth(input.Authorization)
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

		currentJSON, err := k8ssvc.Get(cfg, k8ssvc.GetOptions{
			Resource:  "deployments",
			Name:      input.Name,
			Namespace: resolved.Namespace,
		})
		if err != nil {
			if apierrors.IsNotFound(err) {
				return nil, huma.Error404NotFound("AP not found", err)
			}
			return nil, huma.Error500InternalServerError("failed to get AP for update", err)
		}
		var current appsv1.Deployment
		if err := json.Unmarshal(currentJSON, &current); err != nil {
			return nil, huma.Error500InternalServerError("failed to decode AP for update", err)
		}
		if err := requireBrainAPDeployment(current); err != nil {
			return nil, huma.Error404NotFound("AP not found", err)
		}

		renderInput, paused, err := apRenderInputFromDeploymentPatch(current, input.Body)
		if err != nil {
			return nil, huma.Error400BadRequest("invalid AP update request", err)
		}
		resources, err := orchestration.RenderAPResources(renderInput)
		if err != nil {
			return nil, huma.Error400BadRequest("invalid AP direct resource request", err)
		}
		resources.Deployment.Annotations = mergeStringAnnotations(current.Annotations, resources.Deployment.Annotations)
		applyAPPauseState(resources.Deployment, paused)
		if paused != nil && *paused {
			resources.HPA = nil
		}
		objects := []runtime.Object{resources.Deployment, resources.Service}
		if resources.HPA != nil {
			objects = append(objects, resources.HPA)
		} else if err := deleteAPHPA(cfg, renderInput.Name, renderInput.Namespace); err != nil {
			return nil, huma.Error500InternalServerError("failed to update AP autoscaling", err)
		}
		if err := replaceAPPublicIngresses(restConfig, cfg, renderInput.Name, renderInput.Namespace, renderInput); err != nil {
			return nil, huma.Error500InternalServerError("failed to update AP public routing", err)
		}
		if err := k8ssvc.ApplyObjects(restConfig, objects, resolved.Namespace); err != nil {
			return nil, huma.Error500InternalServerError("failed to update AP", err)
		}

		jsonBytes, err := k8ssvc.Get(cfg, k8ssvc.GetOptions{
			Resource:  "deployments",
			Name:      input.Name,
			Namespace: resolved.Namespace,
		})
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to get updated AP", err)
		}
		body, err := apResponseFromDeployments(jsonBytes, true)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to adapt AP response", err)
		}
		var updated map[string]interface{}
		if err := json.Unmarshal(body, &updated); err != nil {
			return nil, huma.Error500InternalServerError("failed to decode updated AP", err)
		}
		body, err = recordAPImageVersionSideEffect(ctx, body, "update", recordAPImageVersion)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to annotate AP image version warning", err)
		}
		return &updateOutput{Body: body}, nil
	})
}

type apImageVersionRecorder func(context.Context, map[string]interface{}, string) (*apversion.Version, error)

func recordAPImageVersionSideEffect(ctx context.Context, body json.RawMessage, source string, recorder apImageVersionRecorder) (json.RawMessage, error) {
	var ap map[string]interface{}
	if err := json.Unmarshal(body, &ap); err != nil {
		return nil, err
	}
	if _, err := recorder(ctx, ap, source); err != nil {
		return appendAPImageVersionWarning(ap, err)
	}
	return body, nil
}

func appendAPImageVersionWarning(ap map[string]interface{}, recordErr error) (json.RawMessage, error) {
	message := "AP image history could not be recorded"
	if errors.Is(recordErr, apversion.ErrDatabaseNotConfigured) {
		message = "AP image history storage is not configured"
	}
	metadata, _ := ap["metadata"].(map[string]interface{})
	if metadata == nil {
		metadata = map[string]interface{}{}
		ap["metadata"] = metadata
	}
	warnings, _ := metadata["warnings"].([]interface{})
	metadata["warnings"] = append(warnings, map[string]interface{}{
		"code":    "ap-image-history-unavailable",
		"message": message,
	})
	return json.Marshal(ap)
}

func recordAPImageVersion(ctx context.Context, ap map[string]interface{}, source string) (*apversion.Version, error) {
	store, err := apversion.DefaultStore(ctx)
	if err != nil {
		return nil, err
	}
	meta, _ := ap["metadata"].(map[string]interface{})
	spec, _ := ap["spec"].(map[string]interface{})
	input, _ := spec["input"].(map[string]interface{})
	return store.Record(ctx, apversion.RecordInput{
		Namespace:       stringFromMap(meta, "namespace"),
		APName:          stringFromMap(meta, "name"),
		Image:           stringFromMap(input, "image"),
		ImagePullPolicy: stringFromMap(input, "imagePullPolicy"),
		Source:          source,
		SpecSnapshot:    spec,
	})
}

func applyAPPauseState(deployment *appsv1.Deployment, paused *bool) {
	if deployment == nil || paused == nil {
		return
	}
	if deployment.Annotations == nil {
		deployment.Annotations = map[string]string{}
	}
	deployment.Annotations[orchestration.LaunchpadPauseAnnotation] = map[bool]string{true: "true", false: "false"}[*paused]
	if *paused {
		replicas := int32(0)
		deployment.Spec.Replicas = &replicas
		return
	}
	if deployment.Spec.Replicas == nil || *deployment.Spec.Replicas < 1 {
		replicas := int32(1)
		deployment.Spec.Replicas = &replicas
	}
}

func mergeStringAnnotations(base map[string]string, overlays ...map[string]string) map[string]string {
	out := map[string]string{}
	for key, value := range base {
		if value != "" {
			out[key] = value
		}
	}
	for _, overlay := range overlays {
		for key, value := range overlay {
			if value != "" {
				out[key] = value
			}
		}
	}
	return out
}

func apRenderInputFromDeploymentPatch(current appsv1.Deployment, raw json.RawMessage) (orchestration.APResourcesInput, *bool, error) {
	var patch map[string]interface{}
	if err := json.Unmarshal(raw, &patch); err != nil {
		return orchestration.APResourcesInput{}, nil, err
	}
	container := corev1.Container{}
	if len(current.Spec.Template.Spec.Containers) > 0 {
		container = current.Spec.Template.Spec.Containers[0]
	}
	privatePort := int32(80)
	if len(container.Ports) > 0 {
		privatePort = container.Ports[0].ContainerPort
	}
	network := desiredAPNetworkFromDeployment(current)
	if network == nil {
		network = map[string]interface{}{"privatePort": privatePort}
	}
	if normalizedPorts, err := orchestration.NormalizeAPAppListeningPortsFromNetwork(network, privatePort); err == nil && len(normalizedPorts) > 0 {
		privatePort = normalizedPorts[0].Port
	}
	replicas := int32(1)
	if current.Spec.Replicas != nil {
		replicas = *current.Spec.Replicas
	}
	image := container.Image
	imagePullPolicy := container.ImagePullPolicy
	env := container.Env
	envRawSource := current.Annotations[orchestration.APEnvRawSourceAnnotation]
	startupProbe := container.StartupProbe
	livenessProbe := container.LivenessProbe
	readinessProbe := container.ReadinessProbe
	limits := container.Resources.Limits
	requests := container.Resources.Requests
	routingDomain := strings.TrimSpace(current.Labels[orchestration.APRoutingDomainLabel])
	projectID := strings.TrimSpace(current.Labels[orchestration.BrainProjectIDLabel])
	replicaStrategy := orchestration.APReplicaStrategy{
		Fixed: orchestration.APFixedReplicaSettings{Replicas: replicas},
		Type:  "fixed",
	}
	if currentStrategy := apReplicaStrategyFromAnnotation(current.Annotations[orchestration.APReplicaStrategyAnnotation], replicas); currentStrategy != nil {
		replicaStrategy = *currentStrategy
	}
	var paused *bool

	if metadata, _ := patch["metadata"].(map[string]interface{}); metadata != nil {
		if labels, _ := metadata["labels"].(map[string]interface{}); labels != nil {
			if region := stringFromMap(labels, orchestration.APRoutingDomainLabel); region != "" {
				routingDomain = region
			}
		}
	}
	spec, _ := patch["spec"].(map[string]interface{})
	if value, ok := spec["paused"].(bool); ok {
		paused = &value
		if value {
			replicas = 0
		} else if replicas < 1 {
			replicas = 1
		}
	}
	if input, _ := spec["input"].(map[string]interface{}); input != nil {
		if nextImage := stringFromMap(input, "image"); nextImage != "" {
			image = nextImage
		}
		if nextPolicy := stringFromMap(input, "imagePullPolicy"); nextPolicy != "" {
			imagePullPolicy = corev1.PullPolicy(nextPolicy)
		}
		if nextEnv, ok := input["env"].([]interface{}); ok {
			env = envVarsFromValue(nextEnv)
		}
		if value, found := input["envRawSource"]; found {
			envRawSource = toString(value)
		}
		if probes, _ := input["probes"].(map[string]interface{}); probes != nil {
			if _, found := probes["startup"]; found {
				startupProbe = probeFromInput(input, "startup")
			}
			if _, found := probes["liveness"]; found {
				livenessProbe = probeFromInput(input, "liveness")
			}
			if _, found := probes["readiness"]; found {
				readinessProbe = probeFromInput(input, "readiness")
			}
		}
		if networkPatch, _ := input["network"].(map[string]interface{}); networkPatch != nil {
			network = mergeAPNetwork(network, networkPatch)
			if normalizedPorts, err := orchestration.NormalizeAPAppListeningPortsFromNetwork(network, privatePort); err == nil && len(normalizedPorts) > 0 {
				privatePort = normalizedPorts[0].Port
			}
		}
	}
	if resourceSpec, _ := spec["resource"].(map[string]interface{}); resourceSpec != nil {
		if nextStrategy := apReplicaStrategyFromResourceSpec(resourceSpec); nextStrategy != nil {
			replicaStrategy = *nextStrategy
		}
		if nextReplicas := apReplicasFromResourceSpec(resourceSpec); nextReplicas > 0 && !(paused != nil && *paused) {
			replicas = nextReplicas
		}
		if nextLimits := resourceListFromMap(resourceSpec, "limits"); len(nextLimits) > 0 {
			limits = nextLimits
		}
		if nextRequests := resourceListFromMap(resourceSpec, "requests"); len(nextRequests) > 0 {
			requests = nextRequests
		}
	}
	return orchestration.APResourcesInput{
		Env:             env,
		EnvRawSource:    envRawSource,
		Image:           image,
		ImagePullPolicy: imagePullPolicy,
		LivenessProbe:   livenessProbe,
		Name:            current.Name,
		Namespace:       current.Namespace,
		NetworkJSON:     networkJSONFromMap(network),
		PrivatePort:     privatePort,
		ProjectID:       projectID,
		ReadinessProbe:  readinessProbe,
		Replicas:        replicas,
		ResourceLimit:   limits,
		ResourceReq:     requests,
		ReplicaStrategy: &replicaStrategy,
		RoutingDomain:   routingDomain,
		StartupProbe:    startupProbe,
	}, paused, nil
}

func desiredAPNetworkFromDeployment(deployment appsv1.Deployment) map[string]interface{} {
	raw := strings.TrimSpace(deployment.Annotations[orchestration.APDesiredNetworkAnnotation])
	if raw == "" {
		return nil
	}
	var network map[string]interface{}
	if err := json.Unmarshal([]byte(raw), &network); err != nil {
		return nil
	}
	return network
}

func mergeAPNetwork(current map[string]interface{}, patch map[string]interface{}) map[string]interface{} {
	out := map[string]interface{}{}
	for key, value := range current {
		out[key] = value
	}
	for key, value := range patch {
		if value == nil {
			delete(out, key)
			continue
		}
		out[key] = value
	}
	return out
}

func deleteAPHPA(cfg *clientcmdapi.Config, name, namespace string) error {
	_, err := k8ssvc.Delete(cfg, k8ssvc.DeleteOptions{
		Name:      name,
		Namespace: namespace,
		Resource:  "horizontalpodautoscalers",
	})
	if apierrors.IsNotFound(err) || k8ssvc.IsUnknownResourceError(err, "horizontalpodautoscalers") {
		return nil
	}
	return err
}

func replaceAPPublicIngresses(restConfig *rest.Config, cfg *clientcmdapi.Config, name, namespace string, input orchestration.APResourcesInput) error {
	selector := orchestration.BrainManagedByLabel + "=" + orchestration.BrainManagedByValue + "," + orchestration.BrainAppNameLabel + "=" + name + "," + orchestration.BrainResourceKindLabel + "=" + orchestration.ResourceKindEntryPointSupport
	for _, resource := range []string{"ingresses", "certificates", "issuers"} {
		if _, err := k8ssvc.Delete(cfg, k8ssvc.DeleteOptions{
			LabelSelector: selector,
			Namespace:     namespace,
			Resource:      resource,
		}); err != nil && !apierrors.IsNotFound(err) && !k8ssvc.IsUnknownResourceError(err, resource) {
			return err
		}
	}
	var network map[string]interface{}
	if strings.TrimSpace(input.NetworkJSON) != "" {
		if err := json.Unmarshal([]byte(input.NetworkJSON), &network); err != nil {
			return err
		}
	}
	obj := unstructured.Unstructured{Object: map[string]interface{}{
		"metadata": map[string]interface{}{
			"labels":    map[string]interface{}{orchestration.APRoutingDomainLabel: input.RoutingDomain},
			"name":      name,
			"namespace": namespace,
		},
		"spec": map[string]interface{}{
			"projectId": input.ProjectID,
			"input": map[string]interface{}{
				"network": network,
			},
		},
	}}
	normalizeAPPublicNetworkIntent(&obj, namespace)
	objects, err := apPublicIngressesFromObject(obj, namespace)
	if err != nil {
		return err
	}
	if len(objects) == 0 {
		return nil
	}
	return k8ssvc.ApplyObjects(restConfig, objects, namespace)
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
	labelsPatch := map[string]interface{}{}
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
	containerPatch := map[string]interface{}{"name": name}
	if input, _ := spec["input"].(map[string]interface{}); input != nil {
		if image := stringFromMap(input, "image"); image != "" {
			containerPatch["image"] = image
		}
		if policy := stringFromMap(input, "imagePullPolicy"); policy != "" {
			containerPatch["imagePullPolicy"] = policy
		}
		if env, ok := input["env"].([]interface{}); ok {
			containerPatch["env"] = env
		}
		if value, found := input["envRawSource"]; found {
			annotationsPatch[orchestration.APEnvRawSourceAnnotation] = toString(value)
		}
		if network, _ := input["network"].(map[string]interface{}); network != nil {
			annotationsPatch[orchestration.APDesiredNetworkAnnotation] = networkJSONFromMap(network)
			if appListeningPorts := apAppListeningPortsFromNetwork(network); len(appListeningPorts) > 0 {
				ports := make([]interface{}, 0, len(appListeningPorts))
				for _, port := range appListeningPorts {
					ports = append(ports, map[string]interface{}{
						"containerPort": port.Port,
						"name":          orchestration.APPortName(port.Port),
						"protocol":      "TCP",
					})
				}
				containerPatch["ports"] = ports
			}
		}
	}
	if metadata, _ := patch["metadata"].(map[string]interface{}); metadata != nil {
		if labels, _ := metadata["labels"].(map[string]interface{}); labels != nil {
			if region := stringFromMap(labels, orchestration.APRoutingDomainLabel); region != "" {
				labelsPatch[orchestration.APRoutingDomainLabel] = region
			}
		}
	}
	if resources := apContainerResourcesFromProductSpec(spec); len(resources) > 0 {
		containerPatch["resources"] = resources
	}
	if len(containerPatch) > 1 {
		templatePatch["spec"] = map[string]interface{}{
			"containers": []interface{}{containerPatch},
		}
	}
	if resourceSpec, _ := spec["resource"].(map[string]interface{}); resourceSpec != nil {
		if replicas := apReplicasFromResourceSpec(resourceSpec); replicas > 0 && !(hasPaused && paused) {
			deploymentPatch["replicas"] = replicas
		}
	}
	if len(annotationsPatch) > 0 {
		metadataPatch["annotations"] = annotationsPatch
	}
	if len(labelsPatch) > 0 {
		metadataPatch["labels"] = labelsPatch
	}
	if len(templatePatch) > 0 {
		deploymentPatch["template"] = templatePatch
	}
	out := map[string]interface{}{"spec": deploymentPatch}
	if len(metadataPatch) > 0 {
		out["metadata"] = metadataPatch
	}
	bytes, err := json.Marshal(out)
	if err != nil {
		return raw
	}
	return bytes
}

func syncAPPublicIngressesFromPatch(restConfig *rest.Config, cfg *clientcmdapi.Config, name, namespace string, raw json.RawMessage) error {
	network, routingDomain, changed := apNetworkIngressStateFromPatch(raw)
	if !changed {
		return nil
	}
	jsonBytes, err := k8ssvc.Get(cfg, k8ssvc.GetOptions{
		Resource:  "deployments",
		Name:      name,
		Namespace: namespace,
	})
	if err != nil {
		return err
	}
	var deployment unstructured.Unstructured
	if err := json.Unmarshal(jsonBytes, &deployment.Object); err != nil {
		return err
	}
	if network == nil {
		network = desiredAPNetworkFromUnstructured(deployment)
	}
	if routingDomain == "" {
		routingDomain = strings.TrimSpace(deployment.GetLabels()[orchestration.APRoutingDomainLabel])
	}
	obj := unstructured.Unstructured{Object: map[string]interface{}{
		"metadata": map[string]interface{}{
			"labels":    map[string]interface{}{orchestration.APRoutingDomainLabel: routingDomain},
			"name":      name,
			"namespace": namespace,
		},
		"spec": map[string]interface{}{
			"projectId": deployment.GetLabels()[orchestration.BrainProjectIDLabel],
			"input": map[string]interface{}{
				"network": network,
			},
		},
	}}
	normalizeAPPublicNetworkIntent(&obj, namespace)
	objects, err := apPublicIngressesFromObject(obj, namespace)
	if err != nil {
		return err
	}
	selector := orchestration.BrainManagedByLabel + "=" + orchestration.BrainManagedByValue + "," + orchestration.BrainAppNameLabel + "=" + name + "," + orchestration.BrainResourceKindLabel + "=" + orchestration.ResourceKindEntryPointSupport
	for _, resource := range []string{"ingresses", "certificates", "issuers"} {
		if _, err := k8ssvc.Delete(cfg, k8ssvc.DeleteOptions{
			LabelSelector: selector,
			Namespace:     namespace,
			Resource:      resource,
		}); err != nil && !apierrors.IsNotFound(err) && !k8ssvc.IsUnknownResourceError(err, resource) {
			return err
		}
	}
	if len(objects) == 0 {
		return nil
	}
	return k8ssvc.ApplyObjects(restConfig, objects, namespace)
}

func apNetworkIngressStateFromPatch(raw json.RawMessage) (map[string]interface{}, string, bool) {
	var patch map[string]interface{}
	if err := json.Unmarshal(raw, &patch); err != nil {
		return nil, "", false
	}
	changed := false
	var network map[string]interface{}
	spec, _ := patch["spec"].(map[string]interface{})
	if input, _ := spec["input"].(map[string]interface{}); input != nil {
		if value, _ := input["network"].(map[string]interface{}); value != nil {
			network = value
			changed = true
		}
	}
	routingDomain := ""
	if metadata, _ := patch["metadata"].(map[string]interface{}); metadata != nil {
		if labels, _ := metadata["labels"].(map[string]interface{}); labels != nil {
			if region := stringFromMap(labels, orchestration.APRoutingDomainLabel); region != "" {
				routingDomain = region
				changed = true
			}
		}
	}
	return network, routingDomain, changed
}

func desiredAPNetworkFromUnstructured(obj unstructured.Unstructured) map[string]interface{} {
	raw := strings.TrimSpace(obj.GetAnnotations()[orchestration.APDesiredNetworkAnnotation])
	if raw == "" {
		return nil
	}
	var network map[string]interface{}
	if err := json.Unmarshal([]byte(raw), &network); err != nil {
		return nil
	}
	return network
}

func apServicePatchFromProductPatch(raw json.RawMessage) []byte {
	var patch map[string]interface{}
	if err := json.Unmarshal(raw, &patch); err != nil {
		return nil
	}
	spec, _ := patch["spec"].(map[string]interface{})
	input, _ := spec["input"].(map[string]interface{})
	network, _ := input["network"].(map[string]interface{})
	appListeningPorts := apAppListeningPortsFromNetwork(network)
	if len(appListeningPorts) == 0 {
		return nil
	}
	ports := make([]interface{}, 0, len(appListeningPorts))
	for _, port := range appListeningPorts {
		ports = append(ports, map[string]interface{}{
			"name":       orchestration.APPortName(port.Port),
			"port":       port.Port,
			"protocol":   "TCP",
			"targetPort": port.Port,
		})
	}
	bytes, err := json.Marshal(map[string]interface{}{
		"spec": map[string]interface{}{
			"ports": ports,
		},
	})
	if err != nil {
		return nil
	}
	return bytes
}

func apReplicasFromResourceSpec(resourceSpec map[string]interface{}) int32 {
	if resourceSpec == nil {
		return 0
	}
	if replicas := int32FromMap(resourceSpec, "replicas"); replicas > 0 {
		return replicas
	}
	replicaStrategy, _ := resourceSpec["replicaStrategy"].(map[string]interface{})
	if replicaStrategy == nil {
		return 0
	}
	if strategyType := stringFromMap(replicaStrategy, "type"); strategyType != "" && strategyType != "fixed" {
		return 0
	}
	fixed, _ := replicaStrategy["fixed"].(map[string]interface{})
	return int32FromMap(fixed, "replicas")
}

func apReplicaStrategyFromAnnotation(raw string, fallbackReplicas int32) *orchestration.APReplicaStrategy {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	var strategy map[string]interface{}
	if err := json.Unmarshal([]byte(raw), &strategy); err != nil {
		return nil
	}
	return apReplicaStrategyFromMap(strategy, fallbackReplicas)
}

func apReplicaStrategyFromResourceSpec(resourceSpec map[string]interface{}) *orchestration.APReplicaStrategy {
	if resourceSpec == nil {
		return nil
	}
	fallbackReplicas := apReplicasFromResourceSpec(resourceSpec)
	replicaStrategy, _ := resourceSpec["replicaStrategy"].(map[string]interface{})
	if replicaStrategy == nil {
		if fallbackReplicas > 0 {
			return &orchestration.APReplicaStrategy{
				Fixed: orchestration.APFixedReplicaSettings{Replicas: fallbackReplicas},
				Type:  "fixed",
			}
		}
		return nil
	}
	return apReplicaStrategyFromMap(replicaStrategy, fallbackReplicas)
}

func apReplicaStrategyFromMap(value map[string]interface{}, fallbackReplicas int32) *orchestration.APReplicaStrategy {
	if value == nil {
		return nil
	}
	fixed, _ := value["fixed"].(map[string]interface{})
	fixedReplicas := int32FromMap(fixed, "replicas")
	if fixedReplicas < 1 {
		fixedReplicas = fallbackReplicas
	}
	if fixedReplicas < 1 {
		fixedReplicas = 1
	}
	out := &orchestration.APReplicaStrategy{
		Fixed: orchestration.APFixedReplicaSettings{Replicas: fixedReplicas},
		Type:  "fixed",
	}
	if stringFromMap(value, "type") != "elastic" {
		return out
	}
	elastic, _ := value["elastic"].(map[string]interface{})
	if elastic == nil {
		return out
	}
	targetMap, _ := elastic["target"].(map[string]interface{})
	target := orchestration.APElasticReplicaTarget{
		Metric:             stringFromMap(targetMap, "metric"),
		Type:               stringFromMap(targetMap, "type"),
		AverageValue:       stringFromMap(targetMap, "averageValue"),
		UtilizationPercent: int32FromMap(targetMap, "utilizationPercent"),
	}
	out.Type = "elastic"
	out.Elastic = &orchestration.APElasticReplicaSettings{
		MaxReplicas: int32FromMap(elastic, "maxReplicas"),
		MinReplicas: int32FromMap(elastic, "minReplicas"),
		Target:      target,
	}
	return out
}

func apContainerResourcesFromProductSpec(spec map[string]interface{}) map[string]interface{} {
	resourceSpec, _ := spec["resource"].(map[string]interface{})
	if resourceSpec == nil {
		return nil
	}
	out := map[string]interface{}{}
	if limits, _ := resourceSpec["limits"].(map[string]interface{}); len(limits) > 0 {
		out["limits"] = limits
	}
	if requests, _ := resourceSpec["requests"].(map[string]interface{}); len(requests) > 0 {
		out["requests"] = requests
	}
	return out
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
	currentJSON, err := k8ssvc.Get(clientCfg, k8ssvc.GetOptions{
		Resource:  "deployments",
		Name:      name,
		Namespace: namespace,
	})
	if err != nil {
		return err
	}
	var current appsv1.Deployment
	if err := json.Unmarshal(currentJSON, &current); err != nil {
		return err
	}
	if err := requireBrainAPDeployment(current); err != nil {
		return apierrors.NewNotFound(schema.GroupResource{Group: "apps", Resource: "deployments"}, name)
	}
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
	_, err = k8ssvc.Delete(clientCfg, k8ssvc.DeleteOptions{
		Name:      name,
		Namespace: namespace,
		Resource:  "deployments",
	})
	if err != nil && apierrors.IsNotFound(err) {
		return nil
	}
	return err
}

func registerRestart(grp huma.API) {
	type restartBody struct {
		Name      string `json:"name" required:"true" doc:"AP metadata.name; the backing Deployment uses the same name in the same namespace."`
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
		Description: "Rollout-restarts the underlying Deployment for an AP: " +
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

		currentJSON, err := k8ssvc.Get(cfg, k8ssvc.GetOptions{
			Resource:  "deployments",
			Name:      name,
			Namespace: resolved.Namespace,
		})
		if err != nil {
			if apierrors.IsNotFound(err) {
				return nil, huma.Error404NotFound("deployment for AP not found in namespace (expected same name as the AP)", err)
			}
			return nil, huma.Error500InternalServerError("failed to get deployment for AP restart", err)
		}
		var current appsv1.Deployment
		if err := json.Unmarshal(currentJSON, &current); err != nil {
			return nil, huma.Error500InternalServerError("failed to decode AP for restart", err)
		}
		if err := requireBrainAPDeployment(current); err != nil {
			return nil, huma.Error404NotFound("AP not found", err)
		}

		jsonBytes, err := k8ssvc.RolloutRestart(cfg, k8ssvc.RolloutOptions{
			Resource:  "deployment",
			Name:      name,
			Namespace: resolved.Namespace,
		})
		if err != nil {
			if apierrors.IsNotFound(err) {
				return nil, huma.Error404NotFound("deployment for AP not found in namespace (expected same name as the AP)", err)
			}
			return nil, huma.Error500InternalServerError("failed to restart deployment", err)
		}
		return &restartOutput{Body: json.RawMessage(jsonBytes)}, nil
	})
}
