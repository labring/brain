package k8s

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	"sealos/api/route/health"
)

// Register adds the k8s API routes to the Huma API with OpenAPI documentation.
func Register(api huma.API) {
	grp := huma.NewGroup(api, "/api/k8s/v1alpha1")
	registerHealth(grp)
	// Query (read)
	registerGet(grp)
	registerDescribe(grp)
	registerLogs(grp)
	registerTop(grp)
	// Mutation (write)
	registerApply(grp)
	registerDelete(grp)
	registerPatch(grp)
	registerScale(grp)
	registerAutoscale(grp)
	registerRollout(grp)
}

func registerHealth(grp huma.API) {
	huma.Register(grp, huma.Operation{
		OperationID: "k8s-health",
		Method:      http.MethodGet,
		Path:        "/health",
		Summary:     "Health check",
		Tags:        []string{"K8s"},
	}, func(ctx context.Context, input *struct{}) (*health.Output, error) {
		resp := &health.Output{}
		resp.Body.Status = "ok"
		return resp, nil
	})
}
