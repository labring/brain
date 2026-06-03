package entrypoint

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/danielgtaylor/huma/v2"
	networkingv1 "k8s.io/api/networking/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"

	"sealos/api/middleware"
	k8ssvc "sealos/api/service/k8s"
	orchestration "sealos/api/service/orchestration"
)

func registerGet(grp huma.API) {
	type getInput struct {
		middleware.AuthInput
		LabelSelector string `query:"label-selector" doc:"Optional Kubernetes label selector used when listing EntryPoints"`
		Name          string `query:"name" doc:"EntryPoint name (omit to list all in namespace)"`
		Namespace     string `query:"namespace" doc:"Namespace (default from kubeconfig; admin can override)"`
	}
	type getOutput struct {
		Body json.RawMessage
	}

	huma.Register(grp, huma.Operation{
		OperationID: "entrypoint-get",
		Method:      http.MethodGet,
		Path:        "/",
		Summary:     "Get EntryPoint(s)",
		Description: "Get a single EntryPoint view by name or list EntryPoint views in the namespace.\n\nEntryPoint is derived from Brain-managed public routing support resources such as Ingress and Certificate. It exposes AP public access targets for canvas and settings surfaces.",
		Tags:        []string{"EntryPoint"},
	}, func(ctx context.Context, input *getInput) (*getOutput, error) {
		_, cfg, err := middleware.RestConfigFromAuth(input.Authorization)
		if err != nil {
			return nil, huma.Error400BadRequest("invalid kubeconfig", err)
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

		jsonBytes, err := k8ssvc.Get(cfg, k8ssvc.GetOptions{
			LabelSelector: entryPointIngressLabelSelector(input.LabelSelector),
			Resource:      "ingresses",
			Name:          input.Name,
			Namespace:     resolved.Namespace,
		})
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to get EntryPoint(s)", err)
		}
		body, err := entryPointResponseFromIngresses(jsonBytes, input.Name != "")
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to adapt EntryPoint response", err)
		}
		return &getOutput{Body: body}, nil
	})
}

func emptyListForMissingEntryPointResource(err error) (json.RawMessage, bool) {
	if !k8ssvc.IsUnknownResourceError(err, "entrypoints") {
		return nil, false
	}
	return json.RawMessage(`{"apiVersion":"brain.io/direct","kind":"EntryPointList","items":[]}`), true
}

func entryPointIngressLabelSelector(extra string) string {
	base := orchestration.BrainManagedByLabel + "=" + orchestration.BrainManagedByValue + "," + orchestration.BrainResourceKindLabel + "=" + orchestration.ResourceKindEntryPointSupport
	extra = strings.TrimSpace(extra)
	if extra == "" {
		return base
	}
	return base + "," + extra
}

func entryPointResponseFromIngresses(jsonBytes []byte, single bool) (json.RawMessage, error) {
	if single {
		var ingress networkingv1.Ingress
		if err := json.Unmarshal(jsonBytes, &ingress); err != nil {
			return nil, err
		}
		return json.Marshal(orchestration.EntryPointObjectFromIngress(&ingress))
	}
	var list unstructured.UnstructuredList
	if err := json.Unmarshal(jsonBytes, &list); err != nil {
		return nil, err
	}
	items := make([]interface{}, 0, len(list.Items))
	for i := range list.Items {
		var ingress networkingv1.Ingress
		if err := runtime.DefaultUnstructuredConverter.FromUnstructured(list.Items[i].Object, &ingress); err != nil {
			return nil, err
		}
		items = append(items, orchestration.EntryPointObjectFromIngress(&ingress))
	}
	out := map[string]interface{}{
		"apiVersion": "brain.io/direct",
		"items":      items,
		"kind":       "EntryPointList",
	}
	return json.Marshal(out)
}
