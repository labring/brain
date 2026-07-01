package ap

import (
	"context"
	"net/http"
	"strconv"

	"github.com/danielgtaylor/huma/v2"

	"sealos/api/middleware"
	k8ssvc "sealos/api/service/k8s"
)

func registerEvents(grp huma.API) {
	type eventsInput struct {
		middleware.AuthInput
		Limit     string `query:"limit" doc:"Maximum events to return (default 50)"`
		Name      string `query:"name" required:"true" doc:"AP instance name"`
		Namespace string `query:"namespace" doc:"Namespace (default from kubeconfig; admin can override)"`
	}
	type eventsOutput struct {
		Body k8ssvc.APWorkloadEventsResult
	}

	huma.Register(grp, huma.Operation{
		OperationID: "ap-events",
		Method:      http.MethodGet,
		Path:        "/events",
		Summary:     "Get AP workload events",
		Description: "Returns recent Kubernetes events for an AP and its composed workload resources. The AP name is the product-level input; the API gathers related Deployment, StatefulSet, ReplicaSet, and Pod events internally.",
		Tags:        []string{"AP"},
	}, func(ctx context.Context, input *eventsInput) (*eventsOutput, error) {
		_, cfg, err := middleware.RestConfigFromAuth(input.Authorization)
		if err != nil {
			return nil, huma.Error400BadRequest("invalid kubeconfig", err)
		}
		resolved, err := middleware.ResolveContext(cfg, middleware.ResolveOptions{
			Namespace: input.Namespace, DefaultNamespace: ""})
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to resolve request context", err)
		}

		limit, _ := strconv.Atoi(input.Limit)
		events, err := k8ssvc.APWorkloadEvents(resolved.RestConfig, k8ssvc.APWorkloadEventsOptions{
			Limit:     limit,
			Name:      input.Name,
			Namespace: resolved.Namespace,
		})
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to get AP workload events", err)
		}
		return &eventsOutput{Body: events}, nil
	})
}
