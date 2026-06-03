package ap

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/danielgtaylor/huma/v2"
	appsv1 "k8s.io/api/apps/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"

	"sealos/api/middleware"
	k8ssvc "sealos/api/service/k8s"
	orchestration "sealos/api/service/orchestration"
)

func registerGet(grp huma.API) {
	type getInput struct {
		middleware.AuthInput
		LabelSelector string `query:"label-selector" doc:"Optional Kubernetes label selector appended to the Brain-managed AP selector"`
		Name          string `query:"name" doc:"AP instance name (omit to list all in namespace)"`
		Namespace     string `query:"namespace" doc:"Namespace (default from kubeconfig; admin can override)"`
	}
	type getOutput struct {
		Body json.RawMessage
	}

	huma.Register(grp, huma.Operation{
		OperationID: "ap-get",
		Method:      http.MethodGet,
		Path:        "/",
		Summary:     "Get AP(s)",
		Description: "Get a single AP by name or list APs in the namespace.\n\nParameter usage:\n- `name` is optional. If omitted, the endpoint lists all Brain-managed APs in the resolved namespace.\n- `namespace` is optional. It uses the kubeconfig namespace by default; admins can override it.\n- `label-selector` is optional and is appended to the mandatory Brain AP selector.\n\nWhat the AP represents:\n- AP is a Brain product view backed by direct Kubernetes resources, primarily a Deployment and private Service.\n- `brain.io/project-id` is the project ownership boundary for list, canvas, and lifecycle operations.",
		Tags:        []string{"AP"},
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
			LabelSelector: apDeploymentLabelSelector(input.LabelSelector),
			Resource:      "deployments",
			Name:          input.Name,
			Namespace:     resolved.Namespace,
		})
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to get AP(s)", err)
		}
		body, err := apResponseFromDeployments(jsonBytes, input.Name != "")
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to adapt AP response", err)
		}
		return &getOutput{Body: body}, nil
	})
}

func apDeploymentLabelSelector(extra string) string {
	base := orchestration.BrainManagedByLabel + "=" + orchestration.BrainManagedByValue + "," + orchestration.BrainResourceKindLabel + "=" + orchestration.ResourceKindAP
	extra = strings.TrimSpace(extra)
	if extra == "" {
		return base
	}
	return base + "," + extra
}

func apResponseFromDeployments(jsonBytes []byte, single bool) (json.RawMessage, error) {
	if single {
		var deployment appsv1.Deployment
		if err := json.Unmarshal(jsonBytes, &deployment); err != nil {
			return nil, err
		}
		return json.Marshal(orchestration.APObjectFromDeployment(&deployment))
	}
	var list unstructured.UnstructuredList
	if err := json.Unmarshal(jsonBytes, &list); err != nil {
		return nil, err
	}
	items := make([]interface{}, 0, len(list.Items))
	for i := range list.Items {
		var deployment appsv1.Deployment
		if err := runtime.DefaultUnstructuredConverter.FromUnstructured(list.Items[i].Object, &deployment); err != nil {
			return nil, err
		}
		items = append(items, orchestration.APObjectFromDeployment(&deployment))
	}
	out := map[string]interface{}{
		"apiVersion": "brain.io/direct",
		"items":      items,
		"kind":       "APList",
	}
	return json.Marshal(out)
}
