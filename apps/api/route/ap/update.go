package ap

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/rest"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"

	"sealos/api/middleware"
	k8ssvc "sealos/api/service/k8s"
	orchestration "sealos/api/service/orchestration"
)

func registerUpdate(grp huma.API) {
	type updateInput struct {
		middleware.AuthInput
		Name      string          `query:"name" required:"true" doc:"AP instance name to patch"`
		Namespace string          `query:"namespace" doc:"Namespace (default from kubeconfig)"`
		Body      json.RawMessage `contentType:"application/json" required:"true" doc:"JSON merge patch body applied to the AP resource.\n\nWhat to patch:\n- spec.input.image: update the application image.\n- spec.input.command / spec.input.args: replace the container entrypoint command and arguments as whole string lists.\n- spec.input.configMaps: replace AP-managed mounted config files as a whole list.\n- spec.input.storage: replace StatefulSet-backed PVC desired sizes as a whole list. Existing storage mount paths are immutable; PVCs may expand but not shrink.\n- spec.input.network.appListeningPorts: replace App Listening Ports as one coherent Network object.\n- spec.input.network.platformAddresses: replace Public Address requests as one coherent Network object.\n- spec.input.network.customDomains: replace Custom Domain Binding requests as part of the coherent Network object.\n- Legacy spec.input.network.privatePort remains readable as a one-port fallback.\n- spec.resource.replicaStrategy.type: fixed or elastic AP replica behavior.\n- spec.resource.replicaStrategy.fixed.replicas: Fixed Replicas count, 1-20.\n- spec.resource.replicaStrategy.elastic: Elastic Scaling with minReplicas, maxReplicas, and one CPU utilization or Memory average value target.\n- Legacy spec.resource.replicas remains accepted as a Fixed Replicas fallback when replicaStrategy is absent.\n- spec.paused: when true, scale the Deployment or StatefulSet to 0 with SealOS pause annotations; false resumes using the active Fixed Replicas value.\n- spec.restartRequest: bump this integer to request a rollout (alternative: POST .../restart on the workload).\n- spec.input.env: replace the full environment variable list.\n- spec.input.probes: replace health probes (startup, liveness, readiness).\n- spec.resource.requests / spec.resource.limits: container resources.\n- spec.ingressAnnotations: add or replace Ingress annotations.\n\nPatch examples:\n- Pause: {\"spec\":{\"paused\":true}}\n- Resume: {\"spec\":{\"paused\":false}}\n- Update image: {\"spec\":{\"input\":{\"image\":\"nginx:1.27\"}}}\n- Replace Launch Command: {\"spec\":{\"input\":{\"command\":[\"/app/server\"],\"args\":[\"--config\",\"/etc/app/config.yaml\"]}}}\n- Replace Config Files: {\"spec\":{\"input\":{\"configMaps\":[{\"path\":\"/etc/app/config.yaml\",\"value\":\"debug: true\"}]}}}\n- Expand StatefulSet Storage: {\"spec\":{\"input\":{\"storage\":[{\"path\":\"/data\",\"size\":\"20Gi\"}]}}}\n- Replace App Listening Ports: {\"spec\":{\"input\":{\"network\":{\"appListeningPorts\":[{\"port\":80},{\"port\":3000}]}}}}\n- Replace Network with one Public Address: {\"spec\":{\"input\":{\"network\":{\"appListeningPorts\":[{\"port\":8080}],\"platformAddresses\":[{\"id\":\"pa_abc123\",\"port\":8080}]}}}}\n- Change Fixed Replicas: {\"spec\":{\"resource\":{\"replicaStrategy\":{\"type\":\"fixed\",\"fixed\":{\"replicas\":2}}}}}\n- Change CPU Elastic Scaling: {\"spec\":{\"resource\":{\"replicaStrategy\":{\"type\":\"elastic\",\"elastic\":{\"minReplicas\":2,\"maxReplicas\":8,\"target\":{\"metric\":\"cpu\",\"type\":\"utilization\",\"utilizationPercent\":75}}}}}}\n- Change Memory Elastic Scaling: {\"spec\":{\"resource\":{\"replicaStrategy\":{\"type\":\"elastic\",\"elastic\":{\"minReplicas\":2,\"maxReplicas\":8,\"target\":{\"metric\":\"memory\",\"type\":\"averageValue\",\"averageValue\":\"512Mi\"}}}}}}\n\nPatch semantics:\n- Only the fields you send are changed.\n- Nested objects merge at the subtree you provide.\n- Arrays such as spec.input.command, spec.input.args, spec.input.configMaps, spec.input.storage, spec.input.network.appListeningPorts, spec.input.network.platformAddresses, spec.input.network.customDomains, and spec.input.env are replaced as whole lists."`
	}
	type updateOutput struct {
		Body json.RawMessage
	}

	huma.Register(grp, huma.Operation{
		OperationID: "ap-update",
		Method:      http.MethodPatch,
		Path:        "/",
		Summary:     "Update AP",
		Description: "Patch an AP instance by name. The Go API translates supported AP product patch fields into direct Kubernetes Deployment or StatefulSet updates. Supported patch targets include `spec.input.image`, `spec.input.env`, `spec.input.command`, `spec.input.args`, `spec.input.configMaps`, `spec.input.storage`, `spec.input.network`, `spec.resource.replicaStrategy`, `spec.resource.replicas`, and `spec.paused`.",
		Tags:        []string{"AP"},
	}, func(ctx context.Context, input *updateInput) (*updateOutput, error) {
		body, err := updateAP(ctx, apUpdateRequest{
			Authorization: input.Authorization,
			Body:          input.Body,
			Name:          input.Name,
			Namespace:     input.Namespace,
		})
		if err != nil {
			return nil, apUpdateHTTPError(err)
		}
		return &updateOutput{Body: body}, nil
	})
}

type apUpdateRequest struct {
	Authorization string
	Body          json.RawMessage
	Name          string
	Namespace     string
}

type apUpdatePlan struct {
	DeleteConfigMap       bool
	DeleteHPA             bool
	DeleteImagePullSecret bool
	Patch                 []byte
	RenderInput           orchestration.APResourcesInput
	Resources             *orchestration.APResources
	SupportObjects        []runtime.Object
	UpdateRouting         bool
}

type apUpdateErrorKind string

const (
	apUpdateErrorBadRequest apUpdateErrorKind = "bad-request"
	apUpdateErrorInternal   apUpdateErrorKind = "internal"
	apUpdateErrorNotFound   apUpdateErrorKind = "not-found"
)

const templateAPPausedReplicasAnnotation = "brain.io/template-paused-replicas"

type apUpdateError struct {
	err     error
	kind    apUpdateErrorKind
	message string
}

func (err *apUpdateError) Error() string {
	if err.err == nil {
		return err.message
	}
	return err.message + ": " + err.err.Error()
}

func (err *apUpdateError) Unwrap() error {
	return err.err
}

func apUpdateBadRequest(message string, err error) error {
	return &apUpdateError{kind: apUpdateErrorBadRequest, message: message, err: err}
}

func apUpdateInternal(message string, err error) error {
	return &apUpdateError{kind: apUpdateErrorInternal, message: message, err: err}
}

func apUpdateNotFound(message string, err error) error {
	return &apUpdateError{kind: apUpdateErrorNotFound, message: message, err: err}
}

func apUpdateHTTPError(err error) error {
	var updateErr *apUpdateError
	if !errors.As(err, &updateErr) {
		return huma.Error500InternalServerError("failed to update AP", err)
	}
	switch updateErr.kind {
	case apUpdateErrorBadRequest:
		return huma.Error400BadRequest(updateErr.message, updateErr.err)
	case apUpdateErrorNotFound:
		return huma.Error404NotFound(updateErr.message, updateErr.err)
	default:
		return huma.Error500InternalServerError(updateErr.message, updateErr.err)
	}
}

func updateAP(ctx context.Context, req apUpdateRequest) (json.RawMessage, error) {
	restConfig, cfg, err := middleware.RestConfigFromAuth(req.Authorization)
	if err != nil {
		return nil, apUpdateBadRequest("invalid kubeconfig", err)
	}
	if req.Name == "" {
		return nil, apUpdateBadRequest("name is required", nil)
	}
	if len(req.Body) == 0 {
		return nil, apUpdateBadRequest("patch body is required", nil)
	}
	resolved, err := middleware.ResolveContext(cfg, middleware.ResolveOptions{
		Namespace: req.Namespace, DefaultNamespace: ""})
	if err != nil {
		return nil, apUpdateInternal("failed to resolve request context", err)
	}

	workload, err := currentAPWorkload(cfg, resolved.Namespace, req.Name)
	if err != nil {
		if apierrors.IsNotFound(err) {
			return nil, apUpdateNotFound("AP not found", err)
		}
		return nil, apUpdateInternal("failed to get AP for update", err)
	}
	if err := requireBrainAPWorkload(*workload); err != nil {
		return nil, apUpdateNotFound("AP not found", err)
	}

	currentConfigMaps, err := currentAPConfigMapMounts(cfg, *workload)
	if err != nil {
		return nil, apUpdateInternal("failed to read AP config maps", err)
	}
	plan, err := buildAPUpdatePlan(*workload, req.Body, currentConfigMaps, time.Now().UTC())
	if err != nil {
		return nil, err
	}
	if err := applyAPUpdatePlan(ctx, restConfig, cfg, *workload, resolved.Namespace, plan); err != nil {
		return nil, err
	}

	updatedWorkload, err := currentAPWorkload(cfg, resolved.Namespace, req.Name)
	if err != nil {
		return nil, apUpdateInternal("failed to get updated AP", err)
	}
	body, err := apResponseFromWorkloadWithConfigMapValues(cfg, updatedWorkload)
	if err != nil {
		return nil, apUpdateInternal("failed to adapt AP response", err)
	}
	var updated map[string]interface{}
	if err := json.Unmarshal(body, &updated); err != nil {
		return nil, apUpdateInternal("failed to decode updated AP", err)
	}
	body, err = recordAPImageVersionSideEffect(ctx, body, "update", recordAPImageVersion)
	if err != nil {
		return nil, apUpdateInternal("failed to annotate AP image version warning", err)
	}
	return body, nil
}

func templateAPUpdateMergePatch(workload apWorkload, raw json.RawMessage, now time.Time) ([]byte, error) {
	return apUpdateMergePatch(workload, raw, nil, now)
}

func apUpdateMergePatch(workload apWorkload, raw json.RawMessage, currentConfigMaps []orchestration.APConfigMapMount, now time.Time) ([]byte, error) {
	renderInput, paused, err := apRenderInputFromWorkloadPatch(workload, raw, currentConfigMaps)
	if err != nil {
		return nil, err
	}

	out := map[string]interface{}{}
	metadata := map[string]interface{}{}
	annotations := map[string]interface{}{}
	labels := map[string]interface{}{}
	if metadataPatch, _ := apUpdateMetadataPatch(raw); metadataPatch != nil {
		if labelPatch, _ := metadataPatch["labels"].(map[string]interface{}); labelPatch != nil {
			if routingDomain := stringFromMap(labelPatch, orchestration.APRoutingDomainLabel); routingDomain != "" {
				labels[orchestration.APRoutingDomainLabel] = routingDomain
			}
		}
	}
	spec, _ := apUpdateSpecPatch(raw)
	inputPatch := apUpdateInputPatch(raw)
	resourcePatch := templateAPUpdateResourcePatch(raw)
	_, hasReplicaStrategy := resourcePatch["replicaStrategy"]
	_, hasReplicas := resourcePatch["replicas"]
	if _, ok := inputPatch["network"]; ok {
		annotations[orchestration.APDesiredNetworkAnnotation] = renderInput.NetworkJSON
	}
	if _, ok := inputPatch["storage"]; ok {
		rawStorage, err := json.Marshal(renderInput.Storage)
		if err != nil {
			return nil, err
		}
		annotations[orchestration.APDesiredStorageAnnotation] = string(rawStorage)
	}
	if _, ok := inputPatch["envRawSource"]; ok && renderInput.EnvRawSource != workload.Annotations()[orchestration.APEnvRawSourceAnnotation] {
		annotations[orchestration.APEnvRawSourceAnnotation] = renderInput.EnvRawSource
	}
	if hasReplicaStrategy && renderInput.ReplicaStrategy != nil {
		rawStrategy, err := json.Marshal(renderInput.ReplicaStrategy)
		if err != nil {
			return nil, err
		}
		annotations[orchestration.APReplicaStrategyAnnotation] = string(rawStrategy)
	}

	specPatch := map[string]interface{}{}
	templateSpecPatch := map[string]interface{}{}
	if container := apUpdateContainerPatch(workload, inputPatch, resourcePatch, renderInput); len(container) > 0 {
		templateSpecPatch["containers"] = []interface{}{container}
	}
	if _, ok := inputPatch["configMaps"]; ok {
		applyAPConfigMapTemplatePatch(workload, renderInput, currentConfigMaps, templateSpecPatch)
	} else if _, ok := inputPatch["configMap"]; ok {
		applyAPConfigMapTemplatePatch(workload, renderInput, currentConfigMaps, templateSpecPatch)
	}
	if _, ok := inputPatch["imagePullSecrets"]; ok {
		templateSpecPatch["imagePullSecrets"] = renderInput.ImagePullSecrets
	} else if _, ok := inputPatch["imageRegistry"]; ok {
		templateSpecPatch["imagePullSecrets"] = renderInput.ImagePullSecrets
	} else if _, ok := inputPatch["registry"]; ok {
		templateSpecPatch["imagePullSecrets"] = renderInput.ImagePullSecrets
	}
	templatePatch := map[string]interface{}{}
	if len(templateSpecPatch) > 0 {
		templatePatch["spec"] = templateSpecPatch
	}
	if _, ok := spec["restartRequest"]; ok && renderInput.RestartRequest != nil {
		annotations[orchestration.APRestartRequestAnnotation] = strconv.FormatInt(*renderInput.RestartRequest, 10)
		templatePatch["metadata"] = map[string]interface{}{
			"annotations": map[string]interface{}{
				"kubectl.kubernetes.io/restartedAt": now.Format(time.RFC3339),
			},
		}
	}
	if len(templatePatch) > 0 {
		specPatch["template"] = templatePatch
	}
	if paused != nil {
		applyTemplateAPPausePatch(workload, specPatch, annotations, *paused)
	} else if (hasReplicas || hasReplicaStrategy) && renderInput.Replicas > 0 {
		specPatch["replicas"] = renderInput.Replicas
	}
	if len(specPatch) > 0 {
		out["spec"] = specPatch
	}
	if len(annotations) > 0 {
		metadata["annotations"] = annotations
	}
	if len(labels) > 0 {
		metadata["labels"] = labels
	}
	if len(metadata) > 0 {
		out["metadata"] = metadata
	}
	return json.Marshal(out)
}

func apUpdateMetadataPatch(raw json.RawMessage) (map[string]interface{}, bool) {
	var patch map[string]interface{}
	if err := json.Unmarshal(raw, &patch); err != nil {
		return nil, false
	}
	metadata, ok := patch["metadata"].(map[string]interface{})
	return metadata, ok
}

func apUpdateSpecPatch(raw json.RawMessage) (map[string]interface{}, bool) {
	var patch map[string]interface{}
	if err := json.Unmarshal(raw, &patch); err != nil {
		return nil, false
	}
	spec, ok := patch["spec"].(map[string]interface{})
	return spec, ok
}

func apUpdateInputPatch(raw json.RawMessage) map[string]interface{} {
	var patch map[string]interface{}
	if err := json.Unmarshal(raw, &patch); err != nil {
		return nil
	}
	spec, _ := patch["spec"].(map[string]interface{})
	input, _ := spec["input"].(map[string]interface{})
	return input
}

func apUpdateContainerPatch(workload apWorkload, inputPatch map[string]interface{}, resourcePatch map[string]interface{}, input orchestration.APResourcesInput) map[string]interface{} {
	container := map[string]interface{}{}
	for key := range inputPatch {
		switch key {
		case "args":
			container["args"] = input.Args
		case "command":
			container["command"] = input.Command
		case "env":
			container["env"] = templateAPEnvPatch(input.Env)
		case "image":
			container["image"] = input.Image
		case "imagePullPolicy":
			container["imagePullPolicy"] = input.ImagePullPolicy
		case "probes":
			if input.StartupProbe != nil {
				container["startupProbe"] = input.StartupProbe
			}
			if input.LivenessProbe != nil {
				container["livenessProbe"] = input.LivenessProbe
			}
			if input.ReadinessProbe != nil {
				container["readinessProbe"] = input.ReadinessProbe
			}
		}
	}
	resources := map[string]interface{}{}
	if _, ok := resourcePatch["limits"]; ok {
		resources["limits"] = input.ResourceLimit
	}
	if _, ok := resourcePatch["requests"]; ok {
		resources["requests"] = input.ResourceReq
	}
	if len(resources) > 0 {
		container["resources"] = resources
	}
	if len(container) > 0 {
		container["name"] = templateAPContainerName(workload)
	}
	return container
}

func applyAPConfigMapTemplatePatch(workload apWorkload, input orchestration.APResourcesInput, currentConfigMaps []orchestration.APConfigMapMount, templateSpecPatch map[string]interface{}) {
	volumeName := orchestration.APConfigMapVolumeName(input.Name)
	configMapName := orchestration.APConfigMapName(input.Name)
	containerName := templateAPContainerName(workload)
	container, _ := mapFromFirstNamedListItem(templateSpecPatch["containers"], containerName)
	if container == nil {
		container = map[string]interface{}{"name": containerName}
	}
	if len(input.ConfigMaps) == 0 {
		templateSpecPatch["volumes"] = []interface{}{map[string]interface{}{
			"$patch": "delete",
			"name":   volumeName,
		}}
		container["volumeMounts"] = configMapVolumeMountDeletePatches(currentConfigMaps, volumeName)
		templateSpecPatch["containers"] = []interface{}{container}
		return
	}
	volumeMounts := make([]interface{}, 0, len(input.ConfigMaps))
	desiredPaths := map[string]struct{}{}
	for _, item := range input.ConfigMaps {
		desiredPaths[item.Path] = struct{}{}
		volumeMounts = append(volumeMounts, map[string]interface{}{
			"mountPath": item.Path,
			"name":      volumeName,
			"subPath":   orchestration.APConfigMapKey(item.Path),
		})
	}
	for _, item := range currentConfigMaps {
		if _, ok := desiredPaths[item.Path]; ok {
			continue
		}
		volumeMounts = append(volumeMounts, map[string]interface{}{
			"$patch":    "delete",
			"mountPath": item.Path,
		})
	}
	templateSpecPatch["volumes"] = []interface{}{map[string]interface{}{
		"configMap": map[string]interface{}{"name": configMapName},
		"name":      volumeName,
	}}
	container["volumeMounts"] = volumeMounts
	templateSpecPatch["containers"] = []interface{}{container}
}

func configMapVolumeMountDeletePatches(currentConfigMaps []orchestration.APConfigMapMount, volumeName string) []interface{} {
	if len(currentConfigMaps) == 0 {
		return []interface{}{map[string]interface{}{
			"$patch": "delete",
			"name":   volumeName,
		}}
	}
	out := make([]interface{}, 0, len(currentConfigMaps))
	for _, item := range currentConfigMaps {
		out = append(out, map[string]interface{}{
			"$patch":    "delete",
			"mountPath": item.Path,
		})
	}
	return out
}

func mapFromFirstNamedListItem(value interface{}, name string) (map[string]interface{}, bool) {
	rows, _ := value.([]interface{})
	for _, row := range rows {
		item, _ := row.(map[string]interface{})
		if item == nil {
			continue
		}
		if item["name"] == name {
			return item, true
		}
	}
	return nil, false
}

func templateAPEnvPatch(env []corev1.EnvVar) []interface{} {
	out := make([]interface{}, 0, len(env)+1)
	out = append(out, map[string]interface{}{"$patch": "replace"})
	for i := range env {
		out = append(out, env[i])
	}
	return out
}

func templateAPContainerName(workload apWorkload) string {
	if workload.Deployment != nil && len(workload.Deployment.Spec.Template.Spec.Containers) > 0 {
		if name := strings.TrimSpace(workload.Deployment.Spec.Template.Spec.Containers[0].Name); name != "" {
			return name
		}
	}
	if workload.StatefulSet != nil && len(workload.StatefulSet.Spec.Template.Spec.Containers) > 0 {
		if name := strings.TrimSpace(workload.StatefulSet.Spec.Template.Spec.Containers[0].Name); name != "" {
			return name
		}
	}
	if name := strings.TrimSpace(workload.Name()); name != "" {
		return name
	}
	return "main"
}

func templateAPUpdateResourcePatch(raw json.RawMessage) map[string]interface{} {
	var patch map[string]interface{}
	if err := json.Unmarshal(raw, &patch); err != nil {
		return nil
	}
	spec, _ := patch["spec"].(map[string]interface{})
	resourceSpec, _ := spec["resource"].(map[string]interface{})
	return resourceSpec
}

func applyTemplateAPPausePatch(workload apWorkload, specPatch map[string]interface{}, annotations map[string]interface{}, paused bool) {
	annotations[orchestration.LaunchpadPauseAnnotation] = map[bool]string{true: "true", false: "false"}[paused]
	replicas := int32(1)
	if paused {
		if currentReplicas := workloadReplicas(workload); currentReplicas > 0 {
			annotations[templateAPPausedReplicasAnnotation] = strconv.FormatInt(int64(currentReplicas), 10)
		}
		replicas = 0
	} else {
		annotations[templateAPPausedReplicasAnnotation] = nil
		if pausedReplicas := templateAPPausedReplicas(workload); pausedReplicas > 0 {
			replicas = pausedReplicas
		} else if currentReplicas := workloadReplicas(workload); currentReplicas > 0 {
			replicas = currentReplicas
		}
	}
	specPatch["replicas"] = replicas
}

func workloadReplicas(workload apWorkload) int32 {
	if workload.Deployment != nil && workload.Deployment.Spec.Replicas != nil {
		return *workload.Deployment.Spec.Replicas
	}
	if workload.StatefulSet != nil && workload.StatefulSet.Spec.Replicas != nil {
		return *workload.StatefulSet.Spec.Replicas
	}
	return 0
}

func templateAPPausedReplicas(workload apWorkload) int32 {
	value := strings.TrimSpace(workload.Annotations()[templateAPPausedReplicasAnnotation])
	replicas, err := strconv.ParseInt(value, 10, 32)
	if err != nil || replicas < 1 {
		return 0
	}
	return int32(replicas)
}

func buildAPUpdatePlan(current apWorkload, raw json.RawMessage, currentConfigMaps []orchestration.APConfigMapMount, now time.Time) (apUpdatePlan, error) {
	renderInput, paused, err := apRenderInputFromWorkloadPatch(current, raw, currentConfigMaps)
	if err != nil {
		return apUpdatePlan{}, apUpdateBadRequest("invalid AP update request", err)
	}
	patch, err := apUpdateMergePatch(current, raw, currentConfigMaps, now)
	if err != nil {
		return apUpdatePlan{}, apUpdateBadRequest("invalid AP update request", err)
	}
	resources, err := orchestration.RenderAPResources(renderInput)
	if err != nil {
		return apUpdatePlan{}, apUpdateBadRequest("invalid AP direct resource request", err)
	}
	mergeAPWorkloadAnnotations(resources, current.Annotations())
	applyAPResourcesPauseState(resources, paused)
	applyAPResourcesRestartRequest(resources, current.Annotations(), renderInput.RestartRequest, now)
	if paused != nil && *paused {
		resources.HPA = nil
	}
	spec, _ := apUpdateSpecPatch(raw)
	inputPatch := apUpdateInputPatch(raw)
	_, configMapsChanged := inputPatch["configMaps"]
	if !configMapsChanged {
		_, configMapsChanged = inputPatch["configMap"]
	}
	_, networkChanged := inputPatch["network"]
	metadataPatch, _ := apUpdateMetadataPatch(raw)
	metadataLabels, _ := metadataPatch["labels"].(map[string]interface{})
	_, routingDomainChanged := metadataLabels[orchestration.APRoutingDomainLabel]
	imageSecretsChanged := false
	if _, ok := inputPatch["imagePullSecrets"]; ok {
		imageSecretsChanged = true
	}
	if _, ok := inputPatch["imageRegistry"]; ok {
		imageSecretsChanged = true
	}
	if _, ok := inputPatch["registry"]; ok {
		imageSecretsChanged = true
	}
	_, replicaStrategyChanged := templateAPUpdateResourcePatch(raw)["replicaStrategy"]
	supportObjects := []runtime.Object{}
	if configMapsChanged && resources.ConfigMap != nil {
		supportObjects = append(supportObjects, resources.ConfigMap)
	}
	if imageSecretsChanged && resources.ImagePullSecret != nil {
		supportObjects = append(supportObjects, resources.ImagePullSecret)
	}
	if networkChanged && resources.Service != nil {
		supportObjects = append(supportObjects, resources.Service)
	}
	if (replicaStrategyChanged || (paused != nil && !*paused)) && resources.HPA != nil {
		supportObjects = append(supportObjects, resources.HPA)
	}
	return apUpdatePlan{
		DeleteConfigMap:       configMapsChanged && resources.ConfigMap == nil,
		DeleteHPA:             paused != nil && *paused || replicaStrategyChanged && resources.HPA == nil,
		DeleteImagePullSecret: imageSecretsChanged && !apInputReferencesGeneratedImagePullSecret(renderInput),
		Patch:                 patch,
		RenderInput:           renderInput,
		Resources:             resources,
		SupportObjects:        supportObjects,
		UpdateRouting:         networkChanged || routingDomainChanged || strings.TrimSpace(stringFromMap(spec, "ingressAnnotations")) != "",
	}, nil
}

func applyAPUpdatePlan(ctx context.Context, restConfig *rest.Config, cfg *clientcmdapi.Config, workload apWorkload, namespace string, plan apUpdatePlan) error {
	renderInput := plan.RenderInput
	if plan.DeleteHPA {
		if err := deleteAPHPA(cfg, renderInput.Name, renderInput.Namespace); err != nil {
			return apUpdateInternal("failed to update AP autoscaling", err)
		}
	}
	if plan.UpdateRouting {
		if err := replaceAPPublicIngresses(restConfig, cfg, renderInput.Name, renderInput.Namespace, renderInput); err != nil {
			return apUpdateInternal("failed to update AP public routing", err)
		}
	}
	if len(plan.SupportObjects) > 0 {
		if err := k8ssvc.ApplyObjects(restConfig, plan.SupportObjects, namespace); err != nil {
			return apUpdateInternal("failed to update AP support resources", err)
		}
	}
	if !isEmptyJSONPatchObject(plan.Patch) {
		if _, err := k8ssvc.Patch(cfg, k8ssvc.PatchOptions{
			Resource:  workload.Resource(),
			Name:      workload.Name(),
			Namespace: namespace,
			PatchType: k8ssvc.PatchTypeStrategic,
			Patch:     plan.Patch,
		}); err != nil {
			return apUpdateInternal("failed to update AP", err)
		}
	}
	if plan.DeleteConfigMap {
		if err := deleteAPConfigMap(cfg, renderInput.Name, renderInput.Namespace); err != nil {
			return apUpdateInternal("failed to delete AP config map", err)
		}
	}
	if plan.DeleteImagePullSecret {
		if err := deleteAPImagePullSecret(cfg, renderInput.Name, renderInput.Namespace); err != nil {
			return apUpdateInternal("failed to delete AP image pull secret", err)
		}
	}
	if err := patchAPStatefulSetPVCStorage(ctx, restConfig, workload, renderInput.Storage); err != nil {
		return apUpdateInternal("failed to update AP storage", err)
	}
	return nil
}

func isEmptyJSONPatchObject(patch []byte) bool {
	var object map[string]interface{}
	if err := json.Unmarshal(patch, &object); err != nil {
		return false
	}
	return len(object) == 0
}
