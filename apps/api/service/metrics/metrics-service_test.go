package metrics

import (
	"errors"
	"strings"
	"testing"
)

func TestAPMetricQueryRejectsPromQLInjectionValues(t *testing.T) {
	cases := []struct {
		name      string
		namespace string
		resource  string
	}{
		{name: "wildcard namespace", namespace: ".*", resource: "web"},
		{name: "matcher breakout in namespace", namespace: `x",pod=~".*`, resource: "web"},
		{name: "quote in name", namespace: "project-a", resource: `web"}`},
		{name: "uppercase not rfc1123", namespace: "Project-A", resource: "web"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := APMetricQuery(APMetricCPU, tc.namespace, tc.resource); !errors.Is(err, ErrInvalidLabelValue) {
				t.Fatalf("APMetricQuery(%q, %q) error = %v, want ErrInvalidLabelValue", tc.namespace, tc.resource, err)
			}
		})
	}
}

func TestAPMetricQueryAllowsValidLabels(t *testing.T) {
	query, err := APMetricQuery(APMetricCPU, "ns-abc12345", "my-app")
	if err != nil {
		t.Fatalf("APMetricQuery returned error for valid labels: %v", err)
	}
	if !strings.Contains(query, `namespace=~"ns-abc12345"`) {
		t.Fatalf("query missing expected namespace matcher: %s", query)
	}
}

func TestBuildDBQueriesRejectsPromQLInjectionValues(t *testing.T) {
	if _, err := BuildDBQueries(DBPostgres, ".*", "pg"); !errors.Is(err, ErrInvalidLabelValue) {
		t.Fatalf("BuildDBQueries wildcard namespace error = %v, want ErrInvalidLabelValue", err)
	}
	if _, err := BuildDBQueries(DBPostgres, "project-a", `pg"}`); !errors.Is(err, ErrInvalidLabelValue) {
		t.Fatalf("BuildDBQueries injection name error = %v, want ErrInvalidLabelValue", err)
	}
}
