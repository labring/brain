package ap

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	appsv1 "k8s.io/api/apps/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime"
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
		Namespace string `query:"namespace" doc:"Namespace (default from kubeconfig; admin can override)"`
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
		Summary:     "List AP image versions",
		Description: "List image versions recorded for one AP. Version rollback changes only the AP image fields.",
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
		current, err := currentAPDeployment(ctx, cfg, ns, input.Name)
		if err != nil {
			return nil, err
		}
		activeHash := apversion.VersionHash(ns, input.Name, apDeploymentImage(current), apDeploymentImagePullPolicy(current))
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
		Namespace   string `query:"namespace" doc:"Namespace (default from kubeconfig; admin can override)"`
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
		if _, err := currentAPDeployment(ctx, cfg, ns, input.Name); err != nil {
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
		Namespace   string `query:"namespace" doc:"Namespace (default from kubeconfig; admin can override)"`
	}
	type rollbackOutput struct {
		Body json.RawMessage
	}
	huma.Register(grp, huma.Operation{
		OperationID: "ap-version-rollback",
		Method:      http.MethodPost,
		Path:        "/versions/{versionHash}/rollback",
		Summary:     "Rollback AP image",
		Description: "Rollback one AP to a previous image version. Only spec.input.image and imagePullPolicy are changed.",
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
		current, err := currentAPDeployment(ctx, cfg, ns, input.Name)
		if err != nil {
			return nil, err
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
		patchBytes, _ := json.Marshal(patch)
		renderInput, paused, err := apRenderInputFromDeploymentPatch(*current, patchBytes)
		if err != nil {
			return nil, huma.Error400BadRequest("invalid rollback version", err)
		}
		resources, err := orchestration.RenderAPResources(renderInput)
		if err != nil {
			return nil, huma.Error400BadRequest("invalid AP direct resource request", err)
		}
		resources.Deployment.Annotations = mergeStringAnnotations(current.Annotations, resources.Deployment.Annotations)
		applyAPPauseState(resources.Deployment, paused)
		objects := []runtime.Object{resources.Deployment, resources.Service}
		if err := replaceAPPublicIngresses(restConfig, cfg, renderInput.Name, renderInput.Namespace, renderInput); err != nil {
			return nil, huma.Error500InternalServerError("failed to update AP public routing", err)
		}
		if err := k8ssvc.ApplyObjects(restConfig, objects, ns); err != nil {
			return nil, huma.Error500InternalServerError("failed to rollback AP image", err)
		}
		jsonBytes, err := k8ssvc.Get(cfg, k8ssvc.GetOptions{Resource: "deployments", Name: input.Name, Namespace: ns})
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
		if _, err := recordAPImageVersion(ctx, updated, "rollback"); err != nil {
			return nil, huma.Error500InternalServerError("failed to record AP image version", err)
		}
		return &rollbackOutput{Body: body}, nil
	})
}

func resolveAPNamespace(cfg *clientcmdapi.Config, namespace string) (string, error) {
	gvr := middleware.PodsGVR()
	resolved, err := middleware.ResolveContext(cfg, middleware.ResolveOptions{
		Namespace:        namespace,
		AllNamespaces:    false,
		DefaultNamespace: "",
		AdminCheckGVR:    &gvr,
	})
	if err != nil {
		return "", err
	}
	return resolved.Namespace, nil
}

func currentAPDeployment(ctx context.Context, cfg *clientcmdapi.Config, namespace, name string) (*appsv1.Deployment, error) {
	if strings.TrimSpace(name) == "" {
		return nil, huma.Error400BadRequest("name is required", nil)
	}
	jsonBytes, err := k8ssvc.Get(cfg, k8ssvc.GetOptions{Resource: "deployments", Name: name, Namespace: namespace})
	if err != nil {
		if apierrors.IsNotFound(err) {
			return nil, huma.Error404NotFound("AP not found", err)
		}
		return nil, huma.Error500InternalServerError("failed to get AP", err)
	}
	var deployment appsv1.Deployment
	if err := json.Unmarshal(jsonBytes, &deployment); err != nil {
		return nil, huma.Error500InternalServerError("failed to decode AP", err)
	}
	return &deployment, nil
}

func apDeploymentImage(deployment *appsv1.Deployment) string {
	if deployment == nil || len(deployment.Spec.Template.Spec.Containers) == 0 {
		return ""
	}
	return deployment.Spec.Template.Spec.Containers[0].Image
}

func apDeploymentImagePullPolicy(deployment *appsv1.Deployment) string {
	if deployment == nil || len(deployment.Spec.Template.Spec.Containers) == 0 {
		return ""
	}
	return string(deployment.Spec.Template.Spec.Containers[0].ImagePullPolicy)
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
