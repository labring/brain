package db

import (
	"context"
	"errors"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"

	"sealos/api/middleware"
	dbsvc "sealos/api/service/db"
)

func registerAccessHealth(grp huma.API) {
	type dbAccessHealthBody struct {
		ProjectID string `json:"projectId" doc:"Brain Project ID that must match the brain.io/project-id DB ownership label."`
		Namespace string `json:"namespace,omitempty" doc:"Namespace (default from kubeconfig)."`
	}
	type dbAccessHealthInput struct {
		middleware.AuthInput
		Name string `path:"name" doc:"DB metadata.name."`
		Body dbAccessHealthBody
	}
	type dbAccessHealthOutput struct {
		Body dbsvc.AccessHealthResult
	}

	huma.Register(grp, huma.Operation{
		OperationID: "db-access-health",
		Method:      http.MethodPost,
		Path:        "/{name}/access/health",
		Summary:     "Check DB access health",
		Description: "Checks server-side read-only DB access wiring for one managed DB. Requires kubeconfig authorization and Brain Project ID ownership. The response never includes raw database credentials.",
		Tags:        []string{"DB"},
	}, func(ctx context.Context, input *dbAccessHealthInput) (*dbAccessHealthOutput, error) {
		_, cfg, err := middleware.RestConfigFromAuth(input.Authorization)
		if err != nil {
			return nil, huma.Error401Unauthorized("invalid kubeconfig", err)
		}
		projectID := strings.TrimSpace(input.Body.ProjectID)
		if projectID == "" {
			return nil, huma.Error400BadRequest("Brain Project ID is required", nil)
		}
		resolved, err := middleware.ResolveContext(cfg, middleware.ResolveOptions{
			Namespace: input.Body.Namespace, DefaultNamespace: ""})
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to resolve request context", err)
		}

		store, err := dbsvc.NewKubernetesAccessHealthStore(resolved.RestConfig)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to initialize DB access store", err)
		}
		service := dbsvc.AccessHealthService{
			Store: store,
			WhoDB: dbsvc.NewWhoDBHTTPClient(
				os.Getenv("WHODB_URL"),
				http.DefaultClient,
				15*time.Second,
			),
		}
		result, err := service.Check(ctx, dbsvc.AccessHealthRequest{
			Name:      input.Name,
			Namespace: resolved.Namespace,
			ProjectID: projectID,
		})
		if err != nil {
			return nil, accessHealthError(err)
		}
		return &dbAccessHealthOutput{Body: *result}, nil
	})
}

func accessHealthError(err error) error {
	var whoDBQueryErr *dbsvc.WhoDBQueryError
	switch {
	case errors.As(err, &whoDBQueryErr):
		// The health check asks whether access is wired up at all, so a
		// query-level failure still reads as unavailability here.
		return huma.Error503ServiceUnavailable("WhoDB is unavailable", err)
	case errors.Is(err, dbsvc.ErrAccessHealthProjectID):
		return huma.Error400BadRequest("Brain Project ID is required", err)
	case errors.Is(err, dbsvc.ErrAccessHealthDBNotFound):
		return huma.Error404NotFound("DB not found", err)
	case errors.Is(err, dbsvc.ErrAccessHealthProjectForbidden):
		return huma.Error403Forbidden("DB does not belong to project", err)
	case errors.Is(err, dbsvc.ErrAccessHealthProjectMissing):
		return huma.Error409Conflict("DB is missing project ownership metadata", err)
	case errors.Is(err, dbsvc.ErrAccessHealthDBNotReady):
		return huma.Error409Conflict("DB is not ready", err)
	case errors.Is(err, dbsvc.ErrAccessHealthSecretMissing):
		return huma.Error409Conflict("DB connection secret is missing", err)
	case errors.Is(err, dbsvc.ErrAccessHealthUnsupported):
		return huma.Error422UnprocessableEntity("unsupported DB engine", err)
	case errors.Is(err, dbsvc.ErrAccessHealthWhoDBMissing):
		return huma.Error503ServiceUnavailable("WHODB_URL is not configured", err)
	case errors.Is(err, dbsvc.ErrAccessHealthWhoDBTimeout):
		return huma.Error504GatewayTimeout("WhoDB request timed out", err)
	case errors.Is(err, dbsvc.ErrAccessHealthWhoDBUnavailable):
		return huma.Error503ServiceUnavailable("WhoDB is unavailable", err)
	default:
		return huma.Error500InternalServerError("failed to check DB access health", err)
	}
}
