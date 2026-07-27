package workloadtelemetry

import (
	"context"
	"errors"
	"fmt"
	"time"

	metricssvc "sealos/api/service/metrics"
)

type WorkloadKind string

const (
	WorkloadKindAP WorkloadKind = "ap"
	WorkloadKindDB WorkloadKind = "db"
)

type MetricKey string

const (
	MetricCPU     MetricKey = "cpu"
	MetricMemory  MetricKey = "memory"
	MetricStorage MetricKey = "storage"
)

type DBEngine string

const (
	DBMySQL    DBEngine = "mysql"
	DBPostgres DBEngine = "postgres"
	DBRedis    DBEngine = "redis"
	DBMongo    DBEngine = "mongo"
)

var (
	ErrEmptyTargets            = errors.New("snapshot targets are required")
	ErrInvalidTarget           = errors.New("invalid workload target")
	ErrInvalidSamplingWindow   = errors.New("invalid sampling window")
	ErrMetricUnavailable       = errors.New("metric unavailable")
	ErrUnsupportedDBDefinition = errors.New("unsupported db definition")
)

type Target struct {
	Kind      WorkloadKind `json:"kind" required:"true" doc:"Workload kind: ap or db"`
	Name      string       `json:"name" required:"true" doc:"Workload resource name"`
	Namespace string       `json:"namespace" required:"true" doc:"Kubernetes namespace"`
}

type MetricSample struct {
	Value float64 `json:"value"`
}

type ItemError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type SnapshotItem struct {
	Error        *ItemError                 `json:"error,omitempty"`
	MetricErrors map[MetricKey]ItemError    `json:"metricErrors,omitempty"`
	Metrics      map[MetricKey]MetricSample `json:"metrics,omitempty"`
	SampledAt    time.Time                  `json:"sampledAt,omitempty"`
	Target       Target                     `json:"target"`
}

type SnapshotResponse struct {
	Items []SnapshotItem `json:"items"`
}

type InstantSample struct {
	SampledAt time.Time
	Value     float64
}

type InstantQuery struct {
	Key    MetricKey
	Query  string
	Target Target
}

type InstantQuerier interface {
	QueryInstant(ctx context.Context, req InstantQuery) (InstantSample, error)
}

type RangeQuerier interface {
	QueryRange(ctx context.Context, req RangeQuery) ([]SeriesSample, error)
}

type DBResolver interface {
	ResolveDBEngine(ctx context.Context, auth string, namespace string, name string) (DBEngine, error)
}

// APResolver authorizes access to an AP workload's telemetry by reading the
// workload with the caller's credentials, so Kubernetes RBAC — not merely a
// parseable kubeconfig — decides whether the caller may see the metrics. It
// reports the controller kind backing the AP, which query building needs to
// match the workload's pods without capturing same-prefix siblings.
type APResolver interface {
	ResolveAPWorkloadKind(ctx context.Context, auth string, namespace string, name string) (metricssvc.APWorkloadKind, error)
}

type ServiceOptions struct {
	APResolver   APResolver
	DBResolver   DBResolver
	Querier      InstantQuerier
	RangeQuerier RangeQuerier
}

type Service struct {
	apResolver   APResolver
	dbResolver   DBResolver
	querier      InstantQuerier
	rangeQuerier RangeQuerier
}

func NewDefaultService() (*Service, error) {
	querier, err := NewVictoriaMetricsInstantQuerierFromEnv()
	if err != nil {
		return nil, err
	}
	rangeQuerier, err := NewVictoriaMetricsRangeQuerierFromEnv()
	if err != nil {
		return nil, err
	}
	return NewService(ServiceOptions{
		APResolver:   ClusterAPResolver{},
		DBResolver:   ClusterDBResolver{},
		Querier:      querier,
		RangeQuerier: rangeQuerier,
	}), nil
}

func NewService(options ServiceOptions) *Service {
	return &Service{
		apResolver:   options.APResolver,
		dbResolver:   options.DBResolver,
		querier:      options.Querier,
		rangeQuerier: options.RangeQuerier,
	}
}

func (s *Service) Snapshot(ctx context.Context, auth string, targets []Target) (SnapshotResponse, error) {
	if len(targets) == 0 {
		return SnapshotResponse{}, ErrEmptyTargets
	}

	items := make([]SnapshotItem, 0, len(targets))
	for _, target := range targets {
		items = append(items, s.snapshotTarget(ctx, auth, target))
	}

	return SnapshotResponse{Items: items}, nil
}

func (s *Service) snapshotTarget(ctx context.Context, auth string, target Target) SnapshotItem {
	item := SnapshotItem{
		Metrics: make(map[MetricKey]MetricSample),
		Target:  target,
	}
	profiles, err := s.metricProfiles(ctx, auth, target)
	if err != nil {
		item.Error = itemError(err)
		return item
	}

	for _, profile := range profiles {
		sample, err := s.queryMetric(ctx, target, profile)
		if err != nil {
			item.addMetricError(profile.key, err)
			continue
		}
		item.Metrics[profile.key] = MetricSample{Value: sample.Value}
		if sample.SampledAt.After(item.SampledAt) {
			item.SampledAt = sample.SampledAt
		}
	}

	if len(item.Metrics) == 0 {
		item.Metrics = nil
	}
	return item
}

func (s *Service) queryMetric(ctx context.Context, target Target, profile metricProfile) (InstantSample, error) {
	if s.querier == nil {
		return InstantSample{}, ErrMetricUnavailable
	}
	return s.querier.QueryInstant(ctx, InstantQuery{
		Key:    profile.key,
		Query:  profile.query,
		Target: target,
	})
}

func (item *SnapshotItem) addMetricError(key MetricKey, err error) {
	if item.MetricErrors == nil {
		item.MetricErrors = make(map[MetricKey]ItemError)
	}
	item.MetricErrors[key] = *itemError(err)
}

type metricProfile struct {
	key   MetricKey
	query string
}

func (s *Service) metricProfiles(ctx context.Context, auth string, target Target) ([]metricProfile, error) {
	if target.Namespace == "" || target.Name == "" {
		return nil, ErrInvalidTarget
	}
	switch target.Kind {
	case WorkloadKindAP:
		if s.apResolver == nil {
			return nil, ErrInvalidTarget
		}
		kind, err := s.apResolver.ResolveAPWorkloadKind(ctx, auth, target.Namespace, target.Name)
		if err != nil {
			return nil, err
		}
		queries, err := metricssvc.BuildAPQueries(target.Namespace, target.Name, kind)
		if err != nil {
			return nil, err
		}
		return []metricProfile{
			{key: MetricCPU, query: queries[string(metricssvc.APMetricCPU)]},
			{key: MetricMemory, query: queries[string(metricssvc.APMetricMemory)]},
		}, nil
	case WorkloadKindDB:
		if s.dbResolver == nil {
			return nil, ErrUnsupportedDBDefinition
		}
		engine, err := s.dbResolver.ResolveDBEngine(ctx, auth, target.Namespace, target.Name)
		if err != nil {
			return nil, err
		}
		queries, err := metricssvc.BuildDBQueries(metricssvc.DBType(engine), target.Namespace, target.Name)
		if err != nil {
			return nil, err
		}
		return []metricProfile{
			{key: MetricCPU, query: queries[string(metricssvc.MetricCPU)]},
			{key: MetricMemory, query: queries[string(metricssvc.MetricMemory)]},
			{key: MetricStorage, query: queries[string(metricssvc.MetricDisk)]},
		}, nil
	default:
		return nil, ErrInvalidTarget
	}
}

func itemError(err error) *ItemError {
	switch {
	case errors.Is(err, ErrMetricUnavailable):
		return &ItemError{Code: "metric_unavailable", Message: "metric unavailable"}
	case errors.Is(err, ErrUnsupportedDBDefinition):
		return &ItemError{Code: "unsupported_db_definition", Message: "unsupported database definition"}
	case errors.Is(err, ErrInvalidTarget):
		return &ItemError{Code: "invalid_target", Message: "invalid workload target"}
	case errors.Is(err, metricssvc.ErrUncompleteParam):
		return &ItemError{Code: "invalid_target", Message: "invalid workload target"}
	case errors.Is(err, metricssvc.ErrInvalidLabelValue):
		return &ItemError{Code: "invalid_target", Message: "invalid workload target"}
	default:
		return &ItemError{Code: "telemetry_error", Message: fmt.Sprint(err)}
	}
}
