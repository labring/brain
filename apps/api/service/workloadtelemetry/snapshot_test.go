package workloadtelemetry

import (
	"context"
	"errors"
	"testing"
	"time"
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

// fakeAPAuthorizer authorizes only the "namespace/name" workloads it is seeded with,
// standing in for the RBAC-enforcing GET that ClusterAPResolver performs in production.
type fakeAPAuthorizer map[string]bool

func (f fakeAPAuthorizer) AuthorizeAPWorkload(_ context.Context, _ string, namespace string, name string) error {
	if f[namespace+"/"+name] {
		return nil
	}
	return ErrInvalidTarget
}

func TestSnapshotReturnsOneItemPerTargetWithProductMetricKeys(t *testing.T) {
	sampledAt := time.Date(2026, 5, 18, 10, 30, 0, 0, time.UTC)
	service := NewService(ServiceOptions{
		APAuthorizer: fakeAPAuthorizer{"project-a/web": true},
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
		APAuthorizer: fakeAPAuthorizer{"project-a/web": true},
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
		APAuthorizer: fakeAPAuthorizer{},
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
