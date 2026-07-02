package ap

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"

	"sealos/api/middleware"
	"sealos/api/service/apversion"
	k8ssvc "sealos/api/service/k8s"
	orchestration "sealos/api/service/orchestration"
)

type apVersionRow struct {
	Active          bool                   `json:"active"`
	APName          string                 `json:"apName"`
	CreatedAt       string                 `json:"createdAt"`
	Image           string                 `json:"image"`
	ImagePullPolicy string                 `json:"imagePullPolicy,omitempty"`
	Namespace       string                 `json:"namespace"`
	Source          string                 `json:"source"`
	SpecSnapshot    map[string]interface{} `json:"specSnapshot,omitempty"`
	VersionHash     string                 `json:"versionHash"`
}

func registerVersions(grp huma.API) {
	registerVersionList(grp)
	registerVersionDetail(grp)
	registerVersionRollback(grp)
}

func registerVersionList(grp huma.API) {
	type listInput struct {
		middleware.AuthInput
		Name      string `query:"name" required:"true" doc:"AP instance name"`
		Namespace string `query:"namespace" doc:"Namespace (default from kubeconfig)"`
	}
	type listOutput struct {
		Body struct {
			Items []apVersionRow `json:"items"`
		}
	}
	huma.Register(grp, huma.Operation{
		OperationID: "ap-version-list",
		Method:      http.MethodGet,
		Path:        "/versions",
		Summary:     "List AP deployment versions",
		Description: "List deployment versions recorded for one AP. New records include a full AP spec snapshot when available; older image-only records remain readable.",
		Tags:        []string{"AP"},
	}, func(ctx context.Context, input *listInput) (*listOutput, error) {
		_, cfg, err := middleware.RestConfigFromAuth(input.Authorization)
		if err != nil {
			return nil, huma.Error400BadRequest("invalid kubeconfig", err)
		}
		ns, err := resolveAPNamespace(cfg, input.Namespace)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to resolve request context", err)
		}
		current, err := currentAPWorkloadForVersions(cfg, ns, input.Name)
		if err != nil {
			return nil, err
		}
		activeHash, err := currentAPVersionHash(cfg, current)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to compute active AP version", err)
		}
		store, err := apversion.DefaultStore(ctx)
		if err != nil {
			return nil, apVersionStoreError(err)
		}
		versions, err := store.List(ctx, ns, input.Name, activeHash)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to list AP versions", err)
		}
		out := listOutput{}
		out.Body.Items = make([]apVersionRow, 0, len(versions))
		for _, version := range versions {
			out.Body.Items = append(out.Body.Items, apVersionRowFromVersion(version))
		}
		return &out, nil
	})
}

func registerVersionDetail(grp huma.API) {
	type detailInput struct {
		middleware.AuthInput
		VersionHash string `path:"versionHash" doc:"AP image version hash"`
		Name        string `query:"name" required:"true" doc:"AP instance name"`
		Namespace   string `query:"namespace" doc:"Namespace (default from kubeconfig)"`
	}
	type detailOutput struct {
		Body apVersionRow
	}
	huma.Register(grp, huma.Operation{
		OperationID: "ap-version-detail",
		Method:      http.MethodGet,
		Path:        "/versions/{versionHash}",
		Summary:     "Get AP image version",
		Tags:        []string{"AP"},
	}, func(ctx context.Context, input *detailInput) (*detailOutput, error) {
		_, cfg, err := middleware.RestConfigFromAuth(input.Authorization)
		if err != nil {
			return nil, huma.Error400BadRequest("invalid kubeconfig", err)
		}
		ns, err := resolveAPNamespace(cfg, input.Namespace)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to resolve request context", err)
		}
		if _, err := currentAPWorkloadForVersions(cfg, ns, input.Name); err != nil {
			return nil, err
		}
		store, err := apversion.DefaultStore(ctx)
		if err != nil {
			return nil, apVersionStoreError(err)
		}
		version, err := store.Get(ctx, ns, input.Name, input.VersionHash)
		if errors.Is(err, apversion.ErrVersionNotFound) {
			return nil, huma.Error404NotFound("AP version not found", err)
		}
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to get AP version", err)
		}
		return &detailOutput{Body: apVersionRowFromVersion(*version)}, nil
	})
}

func registerVersionRollback(grp huma.API) {
	type rollbackInput struct {
		middleware.AuthInput
		VersionHash string `path:"versionHash" doc:"AP image version hash"`
		Name        string `query:"name" required:"true" doc:"AP instance name"`
		Namespace   string `query:"namespace" doc:"Namespace (default from kubeconfig)"`
	}
	type rollbackOutput struct {
		Body json.RawMessage
	}
	huma.Register(grp, huma.Operation{
		OperationID: "ap-version-rollback",
		Method:      http.MethodPost,
		Path:        "/versions/{versionHash}/rollback",
		Summary:     "Rollback AP deployment",
		Description: "Rollback one AP to a previous recorded AP spec snapshot. Older records without spec snapshots fall back to image-only rollback.",
		Tags:        []string{"AP"},
	}, func(ctx context.Context, input *rollbackInput) (*rollbackOutput, error) {
		restConfig, cfg, err := middleware.RestConfigFromAuth(input.Authorization)
		if err != nil {
			return nil, huma.Error400BadRequest("invalid kubeconfig", err)
		}
		ns, err := resolveAPNamespace(cfg, input.Namespace)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to resolve request context", err)
		}
		store, err := apversion.DefaultStore(ctx)
		if err != nil {
			return nil, apVersionStoreError(err)
		}
		version, err := store.Get(ctx, ns, input.Name, input.VersionHash)
		if errors.Is(err, apversion.ErrVersionNotFound) {
			return nil, huma.Error404NotFound("AP version not found", err)
		}
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to get AP version", err)
		}
		current, err := currentAPWorkloadForVersions(cfg, ns, input.Name)
		if err != nil {
			return nil, err
		}
		patchBytes, err := apVersionRollbackPatch(*version)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to build rollback patch", err)
		}
		configMaps, err := currentAPConfigMapMounts(cfg, *current)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to read AP config maps", err)
		}
		renderInput, paused, err := apRenderInputFromWorkloadPatch(*current, patchBytes, configMaps)
		if err != nil {
			return nil, huma.Error400BadRequest("invalid rollback version", err)
		}
		resources, err := orchestration.RenderAPResources(renderInput)
		if err != nil {
			return nil, huma.Error400BadRequest("invalid AP direct resource request", err)
		}
		mergeAPWorkloadAnnotations(resources, current.Annotations())
		applyAPResourcesPauseState(resources, paused)
		applyAPResourcesRestartRequest(resources, current.Annotations(), renderInput.RestartRequest, time.Now().UTC())
		objects := apRuntimeObjects(resources)
		if resources.HPA != nil {
			objects = append(objects, resources.HPA)
		} else if err := deleteAPHPA(cfg, renderInput.Name, renderInput.Namespace); err != nil {
			return nil, huma.Error500InternalServerError("failed to rollback AP autoscaling", err)
		}
		if err := replaceAPPublicIngresses(restConfig, cfg, renderInput.Name, renderInput.Namespace, renderInput); err != nil {
			return nil, huma.Error500InternalServerError("failed to update AP public routing", err)
		}
		if err := k8ssvc.ApplyObjects(restConfig, objects, ns); err != nil {
			return nil, huma.Error500InternalServerError("failed to rollback AP", err)
		}
		if resources.ConfigMap == nil {
			if err := deleteAPConfigMap(cfg, renderInput.Name, renderInput.Namespace); err != nil {
				return nil, huma.Error500InternalServerError("failed to delete AP config map", err)
			}
		}
		if !apInputReferencesGeneratedImagePullSecret(renderInput) {
			if err := deleteAPImagePullSecret(cfg, renderInput.Name, renderInput.Namespace); err != nil {
				return nil, huma.Error500InternalServerError("failed to delete AP image pull secret", err)
			}
		}
		if err := patchAPStatefulSetPVCStorage(ctx, restConfig, *current, renderInput.Storage); err != nil {
			return nil, huma.Error500InternalServerError("failed to rollback AP storage", err)
		}
		updatedWorkload, err := currentAPWorkload(cfg, ns, input.Name)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to get updated AP", err)
		}
		body, err := apResponseFromWorkloadWithConfigMapValues(cfg, updatedWorkload)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to adapt AP response", err)
		}
		var updated map[string]interface{}
		if err := json.Unmarshal(body, &updated); err != nil {
			return nil, huma.Error500InternalServerError("failed to decode updated AP", err)
		}
		if _, err := recordAPImageVersion(ctx, updated, "rollback"); err != nil {
			return nil, huma.Error500InternalServerError("failed to record AP image version", err)
		}
		return &rollbackOutput{Body: body}, nil
	})
}

func resolveAPNamespace(cfg *clientcmdapi.Config, namespace string) (string, error) {
	resolved, err := middleware.ResolveContext(cfg, middleware.ResolveOptions{
		Namespace: namespace, DefaultNamespace: ""})
	if err != nil {
		return "", err
	}
	return resolved.Namespace, nil
}

func currentAPWorkloadForVersions(cfg *clientcmdapi.Config, namespace, name string) (*apWorkload, error) {
	if strings.TrimSpace(name) == "" {
		return nil, huma.Error400BadRequest("name is required", nil)
	}
	workload, err := currentAPWorkload(cfg, namespace, name)
	if err != nil {
		if apierrors.IsNotFound(err) {
			return nil, huma.Error404NotFound("AP not found", err)
		}
		return nil, huma.Error500InternalServerError("failed to get AP", err)
	}
	if err := requireBrainAPWorkload(*workload); err != nil {
		return nil, huma.Error404NotFound("AP not found", err)
	}
	return workload, nil
}

func apWorkloadImage(workload *apWorkload) string {
	container, ok := apWorkloadContainer(workload)
	if !ok {
		return ""
	}
	return container.Image
}

func apWorkloadImagePullPolicy(workload *apWorkload) string {
	container, ok := apWorkloadContainer(workload)
	if !ok {
		return ""
	}
	return string(container.ImagePullPolicy)
}

func apWorkloadContainer(workload *apWorkload) (corev1.Container, bool) {
	if workload == nil {
		return corev1.Container{}, false
	}
	if workload.Deployment != nil && len(workload.Deployment.Spec.Template.Spec.Containers) > 0 {
		return workload.Deployment.Spec.Template.Spec.Containers[0], true
	}
	if workload.StatefulSet != nil && len(workload.StatefulSet.Spec.Template.Spec.Containers) > 0 {
		return workload.StatefulSet.Spec.Template.Spec.Containers[0], true
	}
	return corev1.Container{}, false
}

func currentAPVersionHash(cfg *clientcmdapi.Config, workload *apWorkload) (string, error) {
	if workload == nil {
		return "", nil
	}
	body, err := apResponseFromWorkloadWithConfigMapValues(cfg, workload)
	if err != nil {
		return "", err
	}
	var ap map[string]interface{}
	if err := json.Unmarshal(body, &ap); err != nil {
		return "", err
	}
	spec, _ := ap["spec"].(map[string]interface{})
	input, _ := spec["input"].(map[string]interface{})
	return apversion.VersionHashForSpec(
		workload.Namespace(),
		workload.Name(),
		stringFromMap(input, "image"),
		stringFromMap(input, "imagePullPolicy"),
		spec,
	), nil
}

func apVersionRollbackPatch(version apversion.Version) ([]byte, error) {
	if len(version.SpecSnapshot) > 0 {
		return json.Marshal(map[string]interface{}{"spec": apFullReplaySpec(version.SpecSnapshot)})
	}
	patch := map[string]interface{}{
		"spec": map[string]interface{}{
			"input": map[string]interface{}{
				"image": version.Image,
			},
		},
	}
	if strings.TrimSpace(version.ImagePullPolicy) != "" {
		patch["spec"].(map[string]interface{})["input"].(map[string]interface{})["imagePullPolicy"] = version.ImagePullPolicy
	}
	return json.Marshal(patch)
}

func apFullReplaySpec(snapshot map[string]interface{}) map[string]interface{} {
	spec := copyStringInterfaceMap(snapshot)
	input, _ := spec["input"].(map[string]interface{})
	if input == nil {
		input = map[string]interface{}{}
		spec["input"] = input
	}
	for _, key := range []string{"args", "command", "configMaps", "env", "imagePullSecrets", "storage"} {
		if _, ok := input[key]; !ok {
			input[key] = []interface{}{}
		}
	}
	probes, _ := input["probes"].(map[string]interface{})
	if probes == nil {
		probes = map[string]interface{}{}
		input["probes"] = probes
	}
	for _, key := range []string{"startup", "liveness", "readiness"} {
		if _, ok := probes[key]; !ok {
			probes[key] = nil
		}
	}
	return spec
}

func copyStringInterfaceMap(in map[string]interface{}) map[string]interface{} {
	out := make(map[string]interface{}, len(in))
	for key, value := range in {
		if nested, ok := value.(map[string]interface{}); ok {
			out[key] = copyStringInterfaceMap(nested)
			continue
		}
		out[key] = value
	}
	return out
}

func apVersionRowFromVersion(version apversion.Version) apVersionRow {
	return apVersionRow{
		Active:          version.Active,
		APName:          version.APName,
		CreatedAt:       version.CreatedAt.Format(time.RFC3339),
		Image:           version.Image,
		ImagePullPolicy: version.ImagePullPolicy,
		Namespace:       version.Namespace,
		Source:          version.Source,
		SpecSnapshot:    version.SpecSnapshot,
		VersionHash:     version.VersionHash,
	}
}

func apVersionStoreError(err error) error {
	if errors.Is(err, apversion.ErrDatabaseNotConfigured) {
		return huma.Error503ServiceUnavailable("AP image version storage is not configured", err)
	}
	return huma.Error500InternalServerError("failed to open AP version storage", err)
}
