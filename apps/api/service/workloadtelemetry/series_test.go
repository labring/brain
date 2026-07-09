package workloadtelemetry

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"
)

type fakeRangeQuerier struct {
	samples map[string][]SeriesSample
}

func (f fakeRangeQuerier) QueryRange(_ context.Context, req RangeQuery) ([]SeriesSample, error) {
	sample, ok := f.samples[string(req.Target.Kind)+":"+req.Target.Name+":"+string(req.Key)]
	if !ok {
		return nil, ErrMetricUnavailable
	}
	return sample, nil
}

func TestSeriesReturnsSingleTargetRowsWithProductMetricKeys(t *testing.T) {
	start := time.Date(2026, 5, 18, 10, 0, 0, 0, time.UTC)
	end := start.Add(2 * time.Minute)
	service := NewService(ServiceOptions{
		DBResolver: fakeDBResolver{"project-a/pg": DBPostgres},
		RangeQuerier: fakeRangeQuerier{samples: map[string][]SeriesSample{
			"db:pg:cpu": {
				{Timestamp: start.Unix(), Value: 10},
				{Timestamp: start.Add(time.Minute).Unix(), Value: 20},
			},
			"db:pg:memory": {
				{Timestamp: start.Unix(), Value: 50},
			},
			"db:pg:storage": {
				{Timestamp: start.Add(time.Minute).Unix(), Value: 75},
			},
		}},
	})

	got, err := service.Series(context.Background(), "Bearer encoded", SeriesRequest{
		End:    end,
		Start:  start,
		Step:   time.Minute,
		Target: Target{Kind: WorkloadKindDB, Namespace: "project-a", Name: "pg"},
	})
	if err != nil {
		t.Fatalf("Series returned error: %v", err)
	}

	wantRows := []SeriesRow{
		{"time": float64(start.Unix()), "cpu": 10, "memory": 50},
		{"time": float64(start.Add(time.Minute).Unix()), "cpu": 20, "storage": 75},
	}
	if !reflect.DeepEqual(got.Rows, wantRows) {
		t.Fatalf("rows = %#v, want %#v", got.Rows, wantRows)
	}
	if _, ok := got.Rows[1]["disk"]; ok {
		t.Fatalf("series rows must not expose disk: %#v", got.Rows)
	}
	if !reflect.DeepEqual(got.Target, Target{Kind: WorkloadKindDB, Namespace: "project-a", Name: "pg"}) {
		t.Fatalf("target = %#v", got.Target)
	}
	if len(got.MetricErrors) != 0 {
		t.Fatalf("metric errors = %#v, want none", got.MetricErrors)
	}
}

func TestSeriesKeepsMetricFailuresLocal(t *testing.T) {
	start := time.Date(2026, 5, 18, 10, 0, 0, 0, time.UTC)
	service := NewService(ServiceOptions{
		APAuthorizer: fakeAPAuthorizer{"project-a/web": true},
		RangeQuerier: fakeRangeQuerier{samples: map[string][]SeriesSample{
			"ap:web:cpu": {{Timestamp: start.Unix(), Value: 42}},
		}},
	})

	got, err := service.Series(context.Background(), "Bearer encoded", SeriesRequest{
		End:    start.Add(time.Hour),
		Start:  start,
		Step:   time.Minute,
		Target: Target{Kind: WorkloadKindAP, Namespace: "project-a", Name: "web"},
	})
	if err != nil {
		t.Fatalf("Series returned request-level error: %v", err)
	}

	if len(got.Rows) != 1 || got.Rows[0]["cpu"] != 42 {
		t.Fatalf("rows = %#v, want CPU row", got.Rows)
	}
	if got.MetricErrors[MetricMemory].Code != "metric_unavailable" {
		t.Fatalf("memory metric error = %#v, want metric_unavailable", got.MetricErrors[MetricMemory])
	}
}

func TestSeriesRejectsInvalidSamplingWindows(t *testing.T) {
	start := time.Date(2026, 5, 18, 10, 0, 0, 0, time.UTC)
	service := NewService(ServiceOptions{RangeQuerier: fakeRangeQuerier{}})

	cases := []struct {
		name string
		req  SeriesRequest
	}{
		{
			name: "start after end",
			req: SeriesRequest{
				End:    start,
				Start:  start.Add(time.Minute),
				Step:   time.Minute,
				Target: Target{Kind: WorkloadKindAP, Namespace: "project-a", Name: "web"},
			},
		},
		{
			name: "too large range",
			req: SeriesRequest{
				End:    start.Add(25 * time.Hour),
				Start:  start,
				Step:   time.Minute,
				Target: Target{Kind: WorkloadKindAP, Namespace: "project-a", Name: "web"},
			},
		},
		{
			name: "too fine step",
			req: SeriesRequest{
				End:    start.Add(time.Hour),
				Start:  start,
				Step:   time.Second,
				Target: Target{Kind: WorkloadKindAP, Namespace: "project-a", Name: "web"},
			},
		},
		{
			name: "too many samples",
			req: SeriesRequest{
				End:    start.Add(24 * time.Hour),
				Start:  start,
				Step:   time.Minute,
				Target: Target{Kind: WorkloadKindAP, Namespace: "project-a", Name: "web"},
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := service.Series(context.Background(), "Bearer encoded", tc.req)
			if !errors.Is(err, ErrInvalidSamplingWindow) {
				t.Fatalf("Series error = %v, want ErrInvalidSamplingWindow", err)
			}
		})
	}
}
