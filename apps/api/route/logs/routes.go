package logs

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/danielgtaylor/huma/v2"

	"sealos/api/middleware"
	"sealos/api/route/health"
	logssvc "sealos/api/service/logs"
)

// Register registers logs endpoints on the given group (e.g. under /api/telemetry/v1alpha1).
func Register(grp huma.API) {
	registerHealth(grp)
	registerQuery(grp)
}

func registerHealth(grp huma.API) {
	huma.Register(grp, huma.Operation{
		OperationID: "logs-health",
		Method:      http.MethodGet,
		Path:        "/logs/health",
		Summary:     "Logs health",
		Description: "Health check for logs endpoints.",
		Tags:        []string{"Logs"},
	}, func(ctx context.Context, input *struct{}) (*health.Output, error) {
		resp := &health.Output{}
		resp.Body.Status = "ok"
		return resp, nil
	})
}

type queryInput struct {
	middleware.AuthInput
	Namespace string `query:"namespace" required:"true" example:"ns-abc123" doc:"Kubernetes namespace"`
	Name      string `query:"name" required:"true" example:"my-app" doc:"Resource name (app label for ap, app.kubernetes.io/instance for db)"`
	Kind      string `query:"kind" required:"true" example:"ap" enum:"ap,db" doc:"Log source kind: ap (app/launchpad) or db (database)"`
	Container string `query:"container" example:"my-app" doc:"Container name. If specified, returns 50 logs for that container. If omitted, returns 10 logs per pod+container combination."`
	Start     string `query:"start" example:"1710000000" doc:"Start unix timestamp (seconds). Default: now - 60min"`
	End       string `query:"end" example:"1710003600" doc:"End unix timestamp (seconds). Default: now"`
	Limit     string `query:"limit" example:"100" doc:"Max entries per pod+container. Default: 10 (all) or 50 (single container)"`
	Search    string `query:"search" example:"error" doc:"Text search pattern in log messages"`
}

type queryOutput struct {
	Body map[string][]map[string]interface{} `doc:"Map of key to log entries. For ap: key is 'pod/container'. For db: key is 'container'. Each log entry contains: _time, _msg, pod, container, stream, node, etc."`
}

func registerQuery(grp huma.API) {
	huma.Register(grp, huma.Operation{
		OperationID: "logs-query",
		Method:      http.MethodGet,
		Path:        "/logs",
		Summary:     "Query logs",
		Description: `Query logs from VictoriaLogs.

**Response format:** Map of key to log entries array.
- For ap (app/launchpad): key is "pod/container" (e.g. "my-app-abc-123/my-app")
- For db (database): key is "container" (e.g. "postgresql")

**Optional query parameters:**
- **start** / **end**: Unix timestamps (seconds) defining the time window. Both must be provided together. Default: last 60 minutes.
- **limit**: Max log entries per pod+container combination (1–10000). Default: 10 (all containers) or 50 (single container).
- **search**: Text pattern to filter log messages (max 500 chars). Matched server-side via regex against _msg.

**Default limits (when limit param is omitted):**
- Without container param: 10 logs per combination
- With container param: 50 logs for that container

**Payload example:**

` + "```json" + `
{
  "my-app-abc-123/my-app": [
    {
      "_time": "2026-03-11T08:36:31.475783223Z",
      "_msg": "Server started on port 8080",
      "pod": "my-app-abc-123",
      "container": "my-app",
      "stream": "stdout",
      "node": "worker-001"
    }
  ]
}
` + "```" + `

**Example requests:**
- All app logs: ?namespace=ns-abc&name=my-app&kind=ap
- Specific container: ?namespace=ns-abc&name=my-app&kind=ap&container=my-app
- All db logs: ?namespace=ns-abc&name=my-db&kind=db
- Specific db container: ?namespace=ns-abc&name=my-db&kind=db&container=postgresql
- With time range and search: ?namespace=ns-abc&name=my-app&kind=ap&start=1710000000&end=1710003600&limit=100&search=error`,
		Tags: []string{"Logs"},
	}, func(ctx context.Context, input *queryInput) (*queryOutput, error) {
		// Validate optional params
		if input.Limit != "" {
			n, err := strconv.Atoi(input.Limit)
			if err != nil || n <= 0 || n > 10000 {
				return nil, huma.Error400BadRequest("limit must be an integer between 1 and 10000", fmt.Errorf("invalid limit: %s", input.Limit))
			}
		}
		if input.Start != "" || input.End != "" {
			s, errS := strconv.ParseInt(input.Start, 10, 64)
			e, errE := strconv.ParseInt(input.End, 10, 64)
			if errS != nil || errE != nil {
				return nil, huma.Error400BadRequest("start and end must both be valid unix timestamps", fmt.Errorf("start=%s end=%s", input.Start, input.End))
			}
			if s > e {
				return nil, huma.Error400BadRequest("start must not be after end", fmt.Errorf("start %d > end %d", s, e))
			}
		}
		if len(input.Search) > 500 {
			return nil, huma.Error400BadRequest("search query too long (max 500 chars)", fmt.Errorf("length: %d", len(input.Search)))
		}

		opts := logssvc.QueryOptions{
			Start:  input.Start,
			End:    input.End,
			Limit:  input.Limit,
			Search: input.Search,
		}

		// Resolve effective namespace and admin status, mirroring k8s query behavior.
		restConfig, cfg, err := middleware.RestConfigFromAuth(input.Authorization)
		if err != nil {
			return nil, huma.Error400BadRequest("invalid kubeconfig", err)
		}
		resolved, err := middleware.ResolveContext(cfg, middleware.ResolveOptions{
			Namespace: input.Namespace, DefaultNamespace: ""})
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to resolve request context", err)
		}

		ns := resolved.Namespace
		kind := input.Kind

		switch kind {
		case "ap", "app":
			data, err := logssvc.QueryAppLogs(ctx, restConfig, ns, input.Name, input.Container, opts)
			if err != nil {
				return nil, mapError(err)
			}
			return &queryOutput{Body: data}, nil

		case "db", "database":
			data, err := logssvc.QueryDBLogs(ctx, restConfig, ns, input.Name, input.Container, opts)
			if err != nil {
				return nil, mapError(err)
			}
			return &queryOutput{Body: data}, nil

		default:
			return nil, huma.Error400BadRequest("kind must be ap or db", logssvc.ErrInvalidKind)
		}
	})
}

func mapError(err error) error {
	switch {
	case errors.Is(err, logssvc.ErrInvalidKind):
		return huma.Error400BadRequest("kind must be ap or db", err)
	case errors.Is(err, logssvc.ErrNoVLHost):
		return huma.Error500InternalServerError("VLSELECT_URL is not configured", err)
	case errors.Is(err, logssvc.ErrUncompleteParam):
		return huma.Error400BadRequest("missing namespace or name", err)
	case errors.Is(err, logssvc.ErrNoPodsFound):
		return huma.Error404NotFound("no pods found", err)
	default:
		return huma.Error500InternalServerError("failed to query VictoriaLogs", err)
	}
}
