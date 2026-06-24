package ap

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"

	"github.com/danielgtaylor/huma/v2"
	"golang.org/x/sync/errgroup"
	appsv1 "k8s.io/api/apps/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"

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
		Description: "Get a single AP by name or list APs in the namespace.\n\nParameter usage:\n- `name` is optional. If omitted, the endpoint lists all Brain-managed APs in the resolved namespace.\n- `namespace` is optional. It uses the kubeconfig namespace by default; admins can override it.\n- `label-selector` is optional and is appended to the mandatory Brain AP selector.\n\nWhat the AP represents:\n- AP is a Brain product view backed by direct Kubernetes workload resources and private Service.\n- `brain.io/project-id` is the project ownership boundary for list, canvas, and lifecycle operations.",
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

		if input.Name != "" {
			workload, err := currentAPWorkload(cfg, resolved.Namespace, input.Name)
			if err != nil {
				if apierrors.IsNotFound(err) {
					return nil, huma.Error404NotFound("AP not found", err)
				}
				return nil, huma.Error500InternalServerError("failed to get AP", err)
			}
			body, err := apResponseFromWorkloadWithConfigMapValues(cfg, workload)
			if err != nil {
				return nil, huma.Error500InternalServerError("failed to adapt AP response", err)
			}
			return &getOutput{Body: body}, nil
		}

		workloadJSON, err := listAPWorkloadJSON(ctx, cfg, resolved.Namespace, input.LabelSelector)
		if err != nil {
			return nil, err
		}
		body, err := apResponseFromWorkloadListsWithPublicAccessSupport(
			cfg,
			workloadJSON.deployments,
			workloadJSON.statefulSets,
		)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to adapt AP response", err)
		}
		return &getOutput{Body: body}, nil
	})
}

func apDeploymentLabelSelector(extra string) string {
	return apWorkloadLabelSelector(extra)
}

type apWorkloadListJSON struct {
	deployments  []byte
	statefulSets []byte
}

func listAPWorkloadJSON(ctx context.Context, cfg *clientcmdapi.Config, namespace string, labelSelector string) (apWorkloadListJSON, error) {
	var out apWorkloadListJSON
	var mu sync.Mutex
	group, _ := errgroup.WithContext(ctx)
	for _, selector := range apLikeWorkloadLabelSelectors(labelSelector) {
		selector := selector
		group.Go(func() error {
			nextDeploymentJSON, err := k8ssvc.Get(cfg, k8ssvc.GetOptions{
				LabelSelector: selector,
				Resource:      "deployments",
				Namespace:     namespace,
			})
			if err != nil && !apierrors.IsNotFound(err) {
				return huma.Error500InternalServerError("failed to list AP deployments", err)
			}
			mu.Lock()
			out.deployments = mergeK8sListJSON(out.deployments, nextDeploymentJSON)
			mu.Unlock()
			return nil
		})
		group.Go(func() error {
			nextStatefulSetJSON, err := k8ssvc.Get(cfg, k8ssvc.GetOptions{
				LabelSelector: selector,
				Resource:      "statefulsets",
				Namespace:     namespace,
			})
			if err != nil && !apierrors.IsNotFound(err) {
				return huma.Error500InternalServerError("failed to list AP statefulsets", err)
			}
			mu.Lock()
			out.statefulSets = mergeK8sListJSON(out.statefulSets, nextStatefulSetJSON)
			mu.Unlock()
			return nil
		})
	}
	return out, group.Wait()
}

func apResponseFromDeployments(jsonBytes []byte, single bool) (json.RawMessage, error) {
	if single {
		var deployment appsv1.Deployment
		if err := json.Unmarshal(jsonBytes, &deployment); err != nil {
			return nil, err
		}
		if err := requireBrainAPDeployment(deployment); err != nil {
			return nil, apierrors.NewNotFound(appsv1.Resource("deployments"), deployment.Name)
		}
		return json.Marshal(orchestration.APObjectFromDeployment(&deployment))
	}
	return apResponseFromWorkloadLists(jsonBytes, nil)
}
