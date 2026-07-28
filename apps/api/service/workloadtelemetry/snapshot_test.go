package workloadtelemetry

import (
	"context"
	"errors"
	"regexp"
	"testing"
	"time"

	metricssvc "sealos/api/service/metrics"
)

type fakeInstantQuerier struct {
	samples map[string]InstantSample
}

func (f fakeInstantQuerier) QueryInstant(_ context.Context, req InstantQuery) (InstantSample, error) {
	sample, ok := f.samples[string(req.Target.Kind)+":"+req.Target.Name+":"+string(req.Key)]
	if !ok {
		return InstantSample{}, ErrMetricUnavailable
	}
	return sample, nil
}

type fakeDBResolver map[string]DBEngine

func (f fakeDBResolver) ResolveDBEngine(_ context.Context, _ string, namespace string, name string) (DBEngine, error) {
	engine, ok := f[namespace+"/"+name]
	if !ok {
		return "", ErrUnsupportedDBDefinition
	}
	return engine, nil
}

// fakeAPResolver resolves only the "namespace/name" workloads it is seeded with,
// standing in for the RBAC-enforcing GET that ClusterAPResolver performs in production.
type fakeAPResolver map[string]metricssvc.APWorkloadKind

func (f fakeAPResolver) ResolveAPWorkloadKind(_ context.Context, _ string, namespace string, name string) (metricssvc.APWorkloadKind, error) {
	kind, ok := f[namespace+"/"+name]
	if !ok {
		return "", ErrInvalidTarget
	}
	return kind, nil
}

// podMatcherPatterns extracts every pod=~"..." pattern from a PromQL query.
func podMatcherPatterns(t *testing.T, query string) []string {
	t.Helper()
	matches := regexp.MustCompile(`pod=~"([^"]+)"`).FindAllStringSubmatch(query, -1)
	if len(matches) == 0 {
		t.Fatalf("query has no pod matcher: %s", query)
	}
	patterns := make([]string, 0, len(matches))
	for _, m := range matches {
		patterns = append(patterns, m[1])
	}
	return patterns
}

// assertPodMatcherIsolation checks every pod matcher in query against pod names
// the way Prometheus does (fully anchored): all of hit must match, none of miss may.
func assertPodMatcherIsolation(t *testing.T, query string, hit []string, miss []string) {
	t.Helper()
	for _, pattern := range podMatcherPatterns(t, query) {
		re, err := regexp.Compile("^(?:" + pattern + ")$")
		if err != nil {
			t.Fatalf("pod pattern %q does not compile: %v", pattern, err)
		}
		for _, pod := range hit {
			if !re.MatchString(pod) {
				t.Errorf("pod pattern %q must match %q", pattern, pod)
			}
		}
		for _, pod := range miss {
			if re.MatchString(pod) {
				t.Errorf("pod pattern %q must not match %q", pattern, pod)
			}
		}
	}
}

// recordingInstantQuerier captures the query sent for each metric key.
type recordingInstantQuerier struct {
	queries map[MetricKey]string
}

func (r *recordingInstantQuerier) QueryInstant(_ context.Context, req InstantQuery) (InstantSample, error) {
	r.queries[req.Key] = req.Query
	return InstantSample{Value: 1}, nil
}

func TestSnapshotReturnsOneItemPerTargetWithProductMetricKeys(t *testing.T) {
	sampledAt := time.Date(2026, 5, 18, 10, 30, 0, 0, time.UTC)
	service := NewService(ServiceOptions{
		APResolver:   fakeAPResolver{"project-a/web": metricssvc.APWorkloadDeployment},
		DBResolver:   fakeDBResolver{"project-a/pg": DBPostgres},
		Querier: fakeInstantQuerier{samples: map[string]InstantSample{
			"ap:web:cpu":    {SampledAt: sampledAt, Value: 42.25},
			"ap:web:memory": {SampledAt: sampledAt, Value: 64.5},
			"db:pg:cpu":     {SampledAt: sampledAt, Value: 12},
			"db:pg:memory":  {SampledAt: sampledAt, Value: 70},
			"db:pg:storage": {SampledAt: sampledAt, Value: 88.75},
		}},
	})

	got, err := service.Snapshot(context.Background(), "Bearer encoded", []Target{
		{Kind: WorkloadKindAP, Namespace: "project-a", Name: "web"},
		{Kind: WorkloadKindDB, Namespace: "project-a", Name: "pg"},
	})
	if err != nil {
		t.Fatalf("Snapshot returned error: %v", err)
	}
	if len(got.Items) != 2 {
		t.Fatalf("items length = %d, want 2", len(got.Items))
	}

	ap := got.Items[0]
	if ap.Target.Kind != WorkloadKindAP || ap.Target.Name != "web" {
		t.Fatalf("unexpected AP target: %#v", ap.Target)
	}
	if ap.SampledAt != sampledAt {
		t.Fatalf("AP sampledAt = %s, want %s", ap.SampledAt, sampledAt)
	}
	if ap.Metrics[MetricCPU].Value != 42.25 || ap.Metrics[MetricMemory].Value != 64.5 {
		t.Fatalf("unexpected AP metrics: %#v", ap.Metrics)
	}
	if _, ok := ap.Metrics[MetricStorage]; ok {
		t.Fatalf("AP snapshot should not expose storage: %#v", ap.Metrics)
	}

	db := got.Items[1]
	if db.Metrics[MetricCPU].Value != 12 || db.Metrics[MetricMemory].Value != 70 || db.Metrics[MetricStorage].Value != 88.75 {
		t.Fatalf("unexpected DB metrics: %#v", db.Metrics)
	}
}

func TestSnapshotKeepsMetricAndTargetFailuresLocal(t *testing.T) {
	sampledAt := time.Date(2026, 5, 18, 11, 0, 0, 0, time.UTC)
	service := NewService(ServiceOptions{
		APResolver:   fakeAPResolver{"project-a/web": metricssvc.APWorkloadDeployment},
		DBResolver:   fakeDBResolver{"project-a/pg": DBPostgres},
		Querier: fakeInstantQuerier{samples: map[string]InstantSample{
			"ap:web:cpu": {SampledAt: sampledAt, Value: 51},
		}},
	})

	got, err := service.Snapshot(context.Background(), "Bearer encoded", []Target{
		{Kind: WorkloadKindAP, Namespace: "project-a", Name: "web"},
		{Kind: WorkloadKindDB, Namespace: "project-a", Name: "missing-db"},
	})
	if err != nil {
		t.Fatalf("Snapshot returned request-level error: %v", err)
	}

	ap := got.Items[0]
	if ap.Error != nil {
		t.Fatalf("AP item error = %#v, want nil", ap.Error)
	}
	if ap.Metrics[MetricCPU].Value != 51 {
		t.Fatalf("AP CPU metric = %#v, want 51", ap.Metrics[MetricCPU])
	}
	if ap.MetricErrors[MetricMemory].Code != "metric_unavailable" {
		t.Fatalf("AP memory metric error = %#v", ap.MetricErrors[MetricMemory])
	}

	db := got.Items[1]
	if db.Error == nil || db.Error.Code != "unsupported_db_definition" {
		t.Fatalf("DB item error = %#v, want unsupported_db_definition", db.Error)
	}
	if len(db.Metrics) != 0 {
		t.Fatalf("DB metrics = %#v, want none", db.Metrics)
	}
}

func TestSnapshotDeniesUnauthorizedAPWorkload(t *testing.T) {
	service := NewService(ServiceOptions{
		APResolver: fakeAPResolver{},
		Querier: fakeInstantQuerier{samples: map[string]InstantSample{
			"ap:web:cpu":    {Value: 99},
			"ap:web:memory": {Value: 99},
		}},
	})

	got, err := service.Snapshot(context.Background(), "Bearer encoded", []Target{
		{Kind: WorkloadKindAP, Namespace: "ns-victim", Name: "web"},
	})
	if err != nil {
		t.Fatalf("Snapshot returned request-level error: %v", err)
	}

	item := got.Items[0]
	if item.Error == nil || item.Error.Code != "invalid_target" {
		t.Fatalf("unauthorized AP item error = %#v, want invalid_target", item.Error)
	}
	if len(item.Metrics) != 0 {
		t.Fatalf("unauthorized AP must expose no metrics, got %#v", item.Metrics)
	}
}

func TestSnapshotRejectsEmptyTargets(t *testing.T) {
	service := NewService(ServiceOptions{
		Querier: fakeInstantQuerier{},
	})

	_, err := service.Snapshot(context.Background(), "Bearer encoded", nil)
	if !errors.Is(err, ErrEmptyTargets) {
		t.Fatalf("Snapshot error = %v, want ErrEmptyTargets", err)
	}
}

// Regression for labring/sealos-private#8: AP queries must keep the full
// workload name so same-prefix siblings (billing-api vs billing-worker) are
// never aggregated together, across every replica and controller kind.
func TestSnapshotAPQueriesIsolateSamePrefixWorkloads(t *testing.T) {
	cases := []struct {
		name string
		kind metricssvc.APWorkloadKind
		hit  []string
		miss []string
	}{
		{
			name: "deployment replicas and rollouts",
			kind: metricssvc.APWorkloadDeployment,
			hit: []string{
				"billing-api-7d9f8b6c4-k2vq8",
				"billing-api-7d9f8b6c4-m4xz2",
				"billing-api-5b6d9c7f4-p6njw",
			},
			miss: []string{
				"billing-api",
				"billing-worker-5c4b8d9f6-x2ab1",
				"billing-api-web-6f7d8b9c4-q2wz8",
				"billing-api-0",
			},
		},
		{
			name: "statefulset ordinals",
			kind: metricssvc.APWorkloadStatefulSet,
			hit:  []string{"billing-api-0", "billing-api-1", "billing-api-12"},
			miss: []string{
				"billing-api",
				"billing-worker-0",
				"billing-api-web-0",
				"billing-api-7d9f8b6c4-k2vq8",
			},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			querier := &recordingInstantQuerier{queries: make(map[MetricKey]string)}
			service := NewService(ServiceOptions{
				APResolver: fakeAPResolver{"project-a/billing-api": tc.kind},
				Querier:    querier,
			})

			got, err := service.Snapshot(context.Background(), "Bearer encoded", []Target{
				{Kind: WorkloadKindAP, Namespace: "project-a", Name: "billing-api"},
			})
			if err != nil {
				t.Fatalf("Snapshot returned error: %v", err)
			}
			if item := got.Items[0]; item.Error != nil {
				t.Fatalf("item error = %#v, want nil", item.Error)
			}
			if len(querier.queries) != 2 {
				t.Fatalf("recorded queries = %#v, want cpu and memory", querier.queries)
			}
			for _, query := range querier.queries {
				assertPodMatcherIsolation(t, query, tc.hit, tc.miss)
			}
		})
	}
}
