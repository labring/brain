package ap

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/danielgtaylor/huma/v2"
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
		Namespace string          `query:"namespace" doc:"Namespace (default from kubeconfig; admin can override)"`
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
	Objects     []runtime.Object
	RenderInput orchestration.APResourcesInput
	Resources   *orchestration.APResources
}

type apUpdateErrorKind string

const (
	apUpdateErrorBadRequest apUpdateErrorKind = "bad-request"
	apUpdateErrorInternal   apUpdateErrorKind = "internal"
	apUpdateErrorNotFound   apUpdateErrorKind = "not-found"
)

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

	gvr := middleware.PodsGVR()
	resolved, err := middleware.ResolveContext(cfg, middleware.ResolveOptions{
		Namespace:        req.Namespace,
		AllNamespaces:    false,
		DefaultNamespace: "",
		AdminCheckGVR:    &gvr,
	})
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

func buildAPUpdatePlan(current apWorkload, raw json.RawMessage, currentConfigMaps []orchestration.APConfigMapMount, now time.Time) (apUpdatePlan, error) {
	renderInput, paused, err := apRenderInputFromWorkloadPatch(current, raw, currentConfigMaps)
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
	objects := apRuntimeObjects(resources)
	if resources.HPA != nil {
		objects = append(objects, resources.HPA)
	}
	return apUpdatePlan{
		Objects:     objects,
		RenderInput: renderInput,
		Resources:   resources,
	}, nil
}

func applyAPUpdatePlan(ctx context.Context, restConfig *rest.Config, cfg *clientcmdapi.Config, workload apWorkload, namespace string, plan apUpdatePlan) error {
	renderInput := plan.RenderInput
	if plan.Resources.HPA == nil {
		if err := deleteAPHPA(cfg, renderInput.Name, renderInput.Namespace); err != nil {
			return apUpdateInternal("failed to update AP autoscaling", err)
		}
	}
	if err := replaceAPPublicIngresses(restConfig, cfg, renderInput.Name, renderInput.Namespace, renderInput); err != nil {
		return apUpdateInternal("failed to update AP public routing", err)
	}
	if err := k8ssvc.ApplyObjects(restConfig, plan.Objects, namespace); err != nil {
		return apUpdateInternal("failed to update AP", err)
	}
	if plan.Resources.ConfigMap == nil {
		if err := deleteAPConfigMap(cfg, renderInput.Name, renderInput.Namespace); err != nil {
			return apUpdateInternal("failed to delete AP config map", err)
		}
	}
	if !apInputReferencesGeneratedImagePullSecret(renderInput) {
		if err := deleteAPImagePullSecret(cfg, renderInput.Name, renderInput.Namespace); err != nil {
			return apUpdateInternal("failed to delete AP image pull secret", err)
		}
	}
	if err := patchAPStatefulSetPVCStorage(ctx, restConfig, workload, renderInput.Storage); err != nil {
		return apUpdateInternal("failed to update AP storage", err)
	}
	return nil
}
