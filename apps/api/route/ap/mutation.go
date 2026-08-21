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
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
	"sigs.k8s.io/yaml"

	"sealos/api/middleware"
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
			resolved, err := middleware.ResolveContext(cfg, middleware.ResolveOptions{
				Namespace: "", DefaultNamespace: "default"})
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
		renderInput := apRenderInputFromObject(obj, ns)
		if err := ensureAPCreateTargetIsBrainManaged(cfg, name, ns, renderInput.WorkloadKind); err != nil {
			return nil, huma.Error409Conflict("AP name conflicts with an incompatible existing workload", err)
		}

		resources, err := orchestration.RenderAPResources(renderInput)
		if err != nil {
			return nil, huma.Error400BadRequest("invalid AP direct resource request", err)
		}
		objects := apRuntimeObjects(resources)
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

		workload, err := currentAPWorkload(cfg, ns, name)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to get created AP", err)
		}

		body, err := apResponseFromWorkloadWithConfigMapValues(cfg, workload)
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
		Args:             stringSliceFromValue(input["args"]),
		Command:          stringSliceFromValue(input["command"]),
		ConfigMaps:       apConfigMapsFromInput(input),
		DisplayName:      strings.TrimSpace(obj.GetAnnotations()[orchestration.BrainDisplayNameAnnotation]),
		Env:              envVarsFromValue(input["env"]),
		EnvRawSource:     stringFromMap(input, "envRawSource"),
		Image:            stringFromMap(input, "image"),
		ImagePullSecrets: imagePullSecretsFromValue(input["imagePullSecrets"]),
		ImagePullPolicy:  corev1.PullPolicy(stringFromMap(input, "imagePullPolicy")),
		ImageRegistry:    imageRegistryFromInput(input),
		LivenessProbe:    probeFromInput(input, "liveness"),
		Name:             obj.GetName(),
		NetworkJSON:      networkJSONFromMap(network),
		Namespace:        namespace,
		PrivatePort:      privatePort,
		ProjectID:        projectID,
		ReadinessProbe:   probeFromInput(input, "readiness"),
		Replicas:         apReplicasFromResourceSpec(resourceSpec),
		ResourceLimit:    resourceListFromMap(resourceSpec, "limits"),
		ResourceReq:      resourceListFromMap(resourceSpec, "requests"),
		ReplicaStrategy:  apReplicaStrategyFromResourceSpec(resourceSpec),
		RestartRequest:   restartRequestFromSpec(spec),
		RoutingDomain:    routingDomainFromObject(obj),
		Storage:          apStorageFromInput(input),
		StartupProbe:     probeFromInput(input, "startup"),
		WorkloadKind:     apWorkloadKindFromSpec(spec),
	}
}

func routingDomainFromObject(obj unstructured.Unstructured) string {
	return strings.TrimSpace(obj.GetLabels()[orchestration.APRoutingDomainLabel])
}

func apRuntimeObjects(resources *orchestration.APResources) []runtime.Object {
	if resources == nil {
		return nil
	}
	objects := []runtime.Object{}
	if resources.ConfigMap != nil {
		objects = append(objects, resources.ConfigMap)
	}
	if resources.ImagePullSecret != nil {
		objects = append(objects, resources.ImagePullSecret)
	}
	if resources.Service != nil {
		objects = append(objects, resources.Service)
	}
	if resources.Deployment != nil {
		objects = append(objects, resources.Deployment)
	}
	if resources.StatefulSet != nil {
		objects = append(objects, resources.StatefulSet)
	}
	return objects
}

func requireBrainAPDeployment(deployment appsv1.Deployment) error {
	return requireLaunchpadAPDeployment(deployment)
}

func requireLaunchpadAPDeployment(deployment appsv1.Deployment) error {
	labels := deployment.GetLabels()
	if strings.TrimSpace(labels[orchestration.LaunchpadAppDeployManagerLabel]) == "" {
		return errors.New("deployment is not a Launchpad AP")
	}
	if labels[orchestration.BrainManagedByLabel] != orchestration.BrainManagedByValue ||
		strings.TrimSpace(labels[orchestration.BrainProjectIDLabel]) == "" {
		return errors.New("deployment is not a Brain-owned Launchpad AP")
	}
	return nil
}

func requireBrainAPLikeDeployment(deployment appsv1.Deployment) error {
	return requireLaunchpadAPDeployment(deployment)
}

func ensureAPCreateTargetIsBrainManaged(cfg *clientcmdapi.Config, name string, namespace string, nextKind orchestration.APWorkloadKind) error {
	deploymentJSON, err := k8ssvc.Get(cfg, k8ssvc.GetOptions{
		Resource:  "deployments",
		Name:      name,
		Namespace: namespace,
	})
	if err == nil {
		var current appsv1.Deployment
		if err := json.Unmarshal(deploymentJSON, &current); err != nil {
			return err
		}
		if err := requireBrainAPDeployment(current); err != nil {
			return err
		}
		if nextKind == orchestration.APWorkloadKindStatefulSet {
			return errors.New("existing Deployment-backed AP cannot be replaced by a StatefulSet-backed AP")
		}
		return nil
	}
	if !apierrors.IsNotFound(err) {
		return err
	}
	statefulSetJSON, err := k8ssvc.Get(cfg, k8ssvc.GetOptions{
		Resource:  "statefulsets",
		Name:      name,
		Namespace: namespace,
	})
	if apierrors.IsNotFound(err) {
		return nil
	}
	if err != nil {
		return err
	}
	var current appsv1.StatefulSet
	if err := json.Unmarshal(statefulSetJSON, &current); err != nil {
		return err
	}
	if err := requireBrainAPStatefulSet(current); err != nil {
		return err
	}
	if err := validateAPStatefulSetReplaceKind(nextKind); err != nil {
		return err
	}
	return nil
}

func validateAPStatefulSetReplaceKind(nextKind orchestration.APWorkloadKind) error {
	if nextKind != orchestration.APWorkloadKindStatefulSet {
		return errors.New("existing StatefulSet-backed AP cannot be replaced by a Deployment-backed AP")
	}
	return nil
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
	return orchestration.APPlatformAddressRequestsFromNetwork(network)
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
	return orchestration.APCustomDomainRequestsFromNetwork(network, apPlatformAddressesFromNetwork(network))
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

func imagePullSecretsFromValue(value interface{}) []corev1.LocalObjectReference {
	rows, ok := value.([]interface{})
	if !ok || len(rows) == 0 {
		return nil
	}
	out := make([]corev1.LocalObjectReference, 0, len(rows))
	for _, row := range rows {
		item, _ := row.(map[string]interface{})
		if item == nil {
			if name, ok := row.(string); ok && strings.TrimSpace(name) != "" {
				out = append(out, corev1.LocalObjectReference{Name: strings.TrimSpace(name)})
			}
			continue
		}
		name := stringFromMap(item, "name")
		if name == "" {
			continue
		}
		out = append(out, corev1.LocalObjectReference{Name: name})
	}
	return out
}

func imageRegistryFromInput(input map[string]interface{}) *orchestration.APImageRegistry {
	registry, _ := input["imageRegistry"].(map[string]interface{})
	if registry == nil {
		registry, _ = input["registry"].(map[string]interface{})
	}
	if registry == nil {
		return nil
	}
	return &orchestration.APImageRegistry{
		Password:      stringFromMap(registry, "password"),
		ServerAddress: firstStringFromMap(registry, "serverAddress", "server", "registry"),
		Username:      stringFromMap(registry, "username"),
	}
}

func restartRequestFromSpec(spec map[string]interface{}) *int64 {
	raw, ok := spec["restartRequest"]
	if !ok {
		return nil
	}
	value, ok := int64Value(raw)
	if !ok {
		return nil
	}
	return &value
}

func stringSliceFromValue(value interface{}) []string {
	rows, ok := value.([]interface{})
	if !ok || len(rows) == 0 {
		return nil
	}
	out := make([]string, 0, len(rows))
	for _, row := range rows {
		item := strings.TrimSpace(toString(row))
		if item == "" {
			continue
		}
		out = append(out, item)
	}
	return out
}

func apConfigMapsFromInput(input map[string]interface{}) []orchestration.APConfigMapMount {
	rows, ok := input["configMaps"].([]interface{})
	if !ok || len(rows) == 0 {
		rows, _ = input["configMap"].([]interface{})
	}
	out := make([]orchestration.APConfigMapMount, 0, len(rows))
	for _, row := range rows {
		item, _ := row.(map[string]interface{})
		if item == nil {
			continue
		}
		path := stringFromMap(item, "path")
		if path == "" {
			path = stringFromMap(item, "mountPath")
		}
		if path == "" {
			continue
		}
		out = append(out, orchestration.APConfigMapMount{
			Path:  path,
			Value: stringFromMap(item, "value"),
		})
	}
	return out
}

func apStorageFromInput(input map[string]interface{}) []orchestration.APStorageMount {
	rows, ok := input["storage"].([]interface{})
	if !ok || len(rows) == 0 {
		return nil
	}
	out := make([]orchestration.APStorageMount, 0, len(rows))
	for _, row := range rows {
		item, _ := row.(map[string]interface{})
		if item == nil {
			continue
		}
		path := stringFromMap(item, "path")
		if path == "" {
			continue
		}
		size := stringFromMap(item, "size")
		if size == "" {
			size = stringFromMap(item, "value")
			if size != "" && !strings.HasSuffix(strings.ToLower(size), "i") {
				size += "Gi"
			}
		}
		out = append(out, orchestration.APStorageMount{
			Path: path,
			Size: size,
		})
	}
	return out
}

func apWorkloadKindFromSpec(spec map[string]interface{}) orchestration.APWorkloadKind {
	workload, _ := spec["workload"].(map[string]interface{})
	return orchestration.APWorkloadKind(strings.ToLower(stringFromMap(workload, "kind")))
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

func firstStringFromMap(values map[string]interface{}, keys ...string) string {
	for _, key := range keys {
		if value := stringFromMap(values, key); value != "" {
			return value
		}
	}
	return ""
}

func int64Value(value interface{}) (int64, bool) {
	switch v := value.(type) {
	case int:
		return int64(v), true
	case int32:
		return int64(v), true
	case int64:
		return v, true
	case float64:
		i := int64(v)
		return i, v == float64(i)
	case json.Number:
		i, err := v.Int64()
		return i, err == nil
	default:
		return 0, false
	}
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

func registerDelete(grp huma.API) {
	type deleteInput struct {
		middleware.AuthInput
		Name      string `query:"name" required:"true" doc:"AP instance name to delete"`
		Namespace string `query:"namespace" doc:"Namespace (default from kubeconfig)"`
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
		Description: "Delete an AP instance by name.\n\nParameter usage:\n- `name` is required and selects the AP to delete.\n- `namespace` is optional. Resolution order is explicit namespace, kubeconfig current-context namespace, then the route default.\n\nBehavior:\n- The Go API explicitly deletes Brain-managed public routing support resources, private Service, and Deployment using brain.io labels.",
		Tags:        []string{"AP"},
	}, func(ctx context.Context, input *deleteInput) (*deleteOutput, error) {
		_, cfg, err := middleware.RestConfigFromAuth(input.Authorization)
		if err != nil {
			return nil, huma.Error400BadRequest("invalid kubeconfig", err)
		}
		if input.Name == "" {
			return nil, huma.Error400BadRequest("name is required", nil)
		}
		resolved, err := middleware.ResolveContext(cfg, middleware.ResolveOptions{
			Namespace: input.Namespace, DefaultNamespace: ""})
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
	workload, err := currentAPWorkload(clientCfg, namespace, name)
	if err != nil {
		return err
	}
	if err := requireBrainAPWorkload(*workload); err != nil {
		if templateRef, ok := templateDeploymentRefFromAPWorkload(*workload); ok {
			return deleteTemplateDeploymentResources(clientCfg, templateRef, namespace)
		}
		return apierrors.NewNotFound(schema.GroupResource{Group: "brain.io", Resource: "aps"}, name)
	}
	selector := apDirectResourceDeleteSelector(name, workloadProjectID(*workload))
	for _, resource := range []string{"certificates", "issuers", "ingresses", "horizontalpodautoscalers", "services", "configmaps", "secrets", "persistentvolumeclaims"} {
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
		Resource:  workload.Resource(),
	})
	if err != nil && apierrors.IsNotFound(err) {
		return nil
	}
	return err
}

func apDirectResourceDeleteSelector(name string, projectID string) string {
	return apPublicRoutingSupportSelector(name, projectID)
}

func templateDeploymentRefFromAPWorkload(workload apWorkload) (templateDeploymentRef, bool) {
	labels := workload.Labels()
	if labels[orchestration.BrainDeploymentKindLabel] != orchestration.DeploymentKindTemplate {
		return templateDeploymentRef{}, false
	}
	name := strings.TrimSpace(labels[orchestration.BrainDeploymentNameLabel])
	projectID := strings.TrimSpace(labels[orchestration.BrainProjectIDLabel])
	return templateDeploymentRef{Name: name, ProjectID: projectID}, name != "" && projectID != ""
}

func registerRestart(grp huma.API) {
	type restartBody struct {
		Name      string `json:"name" required:"true" doc:"AP metadata.name; the backing workload uses the same name in the same namespace."`
		Namespace string `json:"namespace" doc:"Namespace of the AP (default from kubeconfig)."`
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
		Summary:     "Restart AP workload",
		Description: "Rollout-restarts the underlying AP workload. The backing Deployment or StatefulSet is named like the AP (`metadata.name`) in the same namespace.",
		Tags:        []string{"AP"},
	}, func(ctx context.Context, input *restartInput) (*restartOutput, error) {
		_, cfg, err := middleware.RestConfigFromAuth(input.Authorization)
		if err != nil {
			return nil, huma.Error400BadRequest("invalid kubeconfig", err)
		}
		name := strings.TrimSpace(input.Body.Name)
		if name == "" {
			return nil, huma.Error400BadRequest("name is required", nil)
		}
		resolved, err := middleware.ResolveContext(cfg, middleware.ResolveOptions{
			Namespace: input.Body.Namespace, DefaultNamespace: ""})
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to resolve request context", err)
		}

		workload, err := currentAPWorkload(cfg, resolved.Namespace, name)
		if err != nil {
			if apierrors.IsNotFound(err) {
				return nil, huma.Error404NotFound("AP workload not found in namespace (expected same name as the AP)", err)
			}
			return nil, huma.Error500InternalServerError("failed to get AP workload for restart", err)
		}
		if err := requireBrainAPLifecycleWorkload(*workload); err != nil {
			return nil, huma.Error404NotFound("AP not found", err)
		}

		jsonBytes, err := k8ssvc.RolloutRestart(cfg, k8ssvc.RolloutOptions{
			Resource:  workload.RolloutResource(),
			Name:      name,
			Namespace: resolved.Namespace,
		})
		if err != nil {
			if apierrors.IsNotFound(err) {
				return nil, huma.Error404NotFound("AP workload not found in namespace (expected same name as the AP)", err)
			}
			return nil, huma.Error500InternalServerError("failed to restart AP workload", err)
		}
		return &restartOutput{Body: json.RawMessage(jsonBytes)}, nil
	})
}
