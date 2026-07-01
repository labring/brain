package metrics

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"

	"sealos/api/middleware"
	"sealos/api/route/health"
	metricssvc "sealos/api/service/metrics"
	workloadtelemetry "sealos/api/service/workloadtelemetry"
)

type workloadTelemetryService interface {
	Series(context.Context, string, workloadtelemetry.SeriesRequest) (workloadtelemetry.SeriesResponse, error)
	Snapshot(context.Context, string, []workloadtelemetry.Target) (workloadtelemetry.SnapshotResponse, error)
}

var (
	newWorkloadTelemetryService = func() (workloadTelemetryService, error) { return workloadtelemetry.NewDefaultService() }
)

// Register registers metrics endpoints on the given group (e.g. under /api/telemetry/v1alpha1).
func Register(grp huma.API) {
	registerHealth(grp)
	registerSnapshot(grp)
	registerSeries(grp)
}

func registerHealth(grp huma.API) {
	huma.Register(grp, huma.Operation{
		OperationID: "metrics-health",
		Method:      http.MethodGet,
		Path:        "/metrics/health",
		Summary:     "Metrics health",
		Description: "Health check for metrics endpoints.",
		Tags:        []string{"Metrics"},
	}, func(ctx context.Context, input *struct{}) (*health.Output, error) {
		resp := &health.Output{}
		if metricssvc.VictoriaMetricsConfigured() {
			resp.Body.Status = "configured"
		} else {
			resp.Body.Status = "degraded"
		}
		return resp, nil
	})
}

type snapshotBody struct {
	Targets []workloadtelemetry.Target `json:"targets" required:"true" minItems:"1" doc:"Workload targets to snapshot"`
}

type snapshotInput struct {
	Authorization string       `header:"Authorization" required:"true" doc:"Bearer url-encoded kubeconfig"`
	Body          snapshotBody `doc:"Snapshot batch request"`
}

type snapshotOutput struct {
	Body workloadtelemetry.SnapshotResponse
}

type seriesBody struct {
	End    time.Time                `json:"end" required:"true" doc:"Sampling window end time"`
	Start  time.Time                `json:"start" required:"true" doc:"Sampling window start time"`
	Step   string                   `json:"step" required:"true" doc:"Sampling step duration, for example 60s or 5m"`
	Target workloadtelemetry.Target `json:"target" required:"true" doc:"Single workload target to query"`
}

type seriesInput struct {
	Authorization string     `header:"Authorization" required:"true" doc:"Bearer url-encoded kubeconfig"`
	Body          seriesBody `doc:"Single-workload series request"`
}

type seriesOutput struct {
	Body workloadtelemetry.SeriesResponse
}

func registerSnapshot(grp huma.API) {
	huma.Register(grp, huma.Operation{
		OperationID: "metrics-snapshot",
		Method:      http.MethodPost,
		Path:        "/metrics/snapshot",
		Summary:     "Snapshot workload metrics",
		Description: "Batch latest AP and DB workload telemetry snapshots for canvas footer metrics.",
		Tags:        []string{"Metrics"},
	}, func(ctx context.Context, input *snapshotInput) (*snapshotOutput, error) {
		authz, err := authorizeSnapshotTelemetry(input)
		if err != nil {
			return nil, err
		}

		service, err := newWorkloadTelemetryService()
		if err != nil {
			return nil, telemetryServiceError(err)
		}
		data, err := service.Snapshot(ctx, authz, input.Body.Targets)
		if err != nil {
			return nil, telemetryServiceError(err)
		}
		return &snapshotOutput{Body: data}, nil
	})
}

func authorizeSnapshotTelemetry(input *snapshotInput) (string, error) {
	return authorizeTelemetryNamespaces(input.Authorization, snapshotNamespaces(input.Body.Targets)...)
}

func registerSeries(grp huma.API) {
	huma.Register(grp, huma.Operation{
		OperationID: "metrics-series",
		Method:      http.MethodPost,
		Path:        "/metrics/series",
		Summary:     "Query workload metric series",
		Description: "Query a bounded AP or DB workload telemetry series for one workload target.",
		Tags:        []string{"Metrics"},
	}, func(ctx context.Context, input *seriesInput) (*seriesOutput, error) {
		step, err := time.ParseDuration(strings.TrimSpace(input.Body.Step))
		if err != nil {
			return nil, huma.Error400BadRequest("invalid sampling step", err)
		}

		authz, err := authorizeTelemetryNamespaces(input.Authorization, input.Body.Target.Namespace)
		if err != nil {
			return nil, err
		}

		service, err := newWorkloadTelemetryService()
		if err != nil {
			return nil, telemetryServiceError(err)
		}
		data, err := service.Series(ctx, authz, workloadtelemetry.SeriesRequest{
			End:    input.Body.End,
			Start:  input.Body.Start,
			Step:   step,
			Target: input.Body.Target,
		})
		if err != nil {
			return nil, telemetryServiceError(err)
		}
		return &seriesOutput{Body: data}, nil
	})
}

func snapshotNamespaces(targets []workloadtelemetry.Target) []string {
	seen := make(map[string]struct{}, len(targets))
	out := make([]string, 0, len(targets))
	for _, target := range targets {
		ns := strings.TrimSpace(target.Namespace)
		if ns == "" {
			continue
		}
		if _, ok := seen[ns]; ok {
			continue
		}
		seen[ns] = struct{}{}
		out = append(out, ns)
	}
	return out
}

func authorizeTelemetryNamespaces(authHeader string, namespaces ...string) (string, error) {
	authz := strings.TrimSpace(authHeader)
	if authz == "" {
		return "", huma.Error400BadRequest("Authorization is required", nil)
	}
	cfg, err := middleware.ConfigFromAuth(authz)
	if err != nil {
		return "", huma.Error400BadRequest("invalid kubeconfig", err)
	}

	for _, namespace := range namespaces {
		if _, err := middleware.ResolveContext(cfg, middleware.ResolveOptions{
			Namespace:        namespace,
			DefaultNamespace: "",
		}); err != nil {
			return "", huma.Error500InternalServerError("failed to resolve request context", err)
		}
	}
	return authz, nil
}

func telemetryServiceError(err error) error {
	switch {
	case errors.Is(err, workloadtelemetry.ErrEmptyTargets):
		return huma.Error400BadRequest("snapshot targets are required", err)
	case errors.Is(err, workloadtelemetry.ErrInvalidSamplingWindow):
		return huma.Error400BadRequest("invalid sampling window", err)
	case errors.Is(err, workloadtelemetry.ErrInvalidTarget):
		return huma.Error400BadRequest("invalid workload target", err)
	case errors.Is(err, workloadtelemetry.ErrUnsupportedDBDefinition):
		return huma.Error400BadRequest("unsupported database definition", err)
	case errors.Is(err, metricssvc.ErrUncompleteParam):
		return huma.Error400BadRequest("invalid workload target", err)
	case errors.Is(err, workloadtelemetry.ErrNoVictoriaMetricsURL):
		return huma.Error500InternalServerError("VMSELECT_URL is not configured", err)
	default:
		return huma.Error500InternalServerError("failed to query workload telemetry", err)
	}
}
