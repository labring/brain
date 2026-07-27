package metrics

import (
	"errors"
	"regexp"
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
			if _, err := APMetricQuery(APMetricCPU, tc.namespace, tc.resource, APWorkloadDeployment); !errors.Is(err, ErrInvalidLabelValue) {
				t.Fatalf("APMetricQuery(%q, %q) error = %v, want ErrInvalidLabelValue", tc.namespace, tc.resource, err)
			}
		})
	}
}

func TestAPMetricQueryAllowsValidLabels(t *testing.T) {
	query, err := APMetricQuery(APMetricCPU, "ns-abc12345", "my-app", APWorkloadDeployment)
	if err != nil {
		t.Fatalf("APMetricQuery returned error for valid labels: %v", err)
	}
	if !strings.Contains(query, `namespace=~"ns-abc12345"`) {
		t.Fatalf("query missing expected namespace matcher: %s", query)
	}
}

func TestAPMetricQueryRejectsUnknownWorkloadKind(t *testing.T) {
	if _, err := APMetricQuery(APMetricCPU, "project-a", "web", APWorkloadKind("")); err == nil {
		t.Fatal("APMetricQuery with empty workload kind must fail")
	}
	if _, err := BuildAPQueries("project-a", "web", APWorkloadKind("daemonset")); err == nil {
		t.Fatal("BuildAPQueries with unknown workload kind must fail")
	}
}

// Regression for labring/sealos-private#8: the pod pattern must keep the full
// workload name and bound the controller-generated suffix, so pods of a
// same-prefix sibling workload never match. Patterns are checked the way
// Prometheus evaluates them: fully anchored.
func TestAPPodPatternIsolatesSamePrefixWorkloads(t *testing.T) {
	cases := []struct {
		name string
		kind APWorkloadKind
		hit  []string
		miss []string
	}{
		{
			name: "deployment replicas and rollouts",
			kind: APWorkloadDeployment,
			hit: []string{
				"billing-api-7d9f8b6c4-k2vq8",
				"billing-api-7d9f8b6c4-m4xz2",
				"billing-api-5b6d9c7f4-p6njw",
			},
			miss: []string{
				"billing-api",
				"billing-api-7d9f8b6c4",
				"billing-worker-5c4b8d9f6-x2ab1",
				"billing-api-web-6f7d8b9c4-q2wz8",
				"billing-api-0",
			},
		},
		{
			name: "statefulset ordinals",
			kind: APWorkloadStatefulSet,
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
			pattern, err := apPodPattern("billing-api", tc.kind)
			if err != nil {
				t.Fatalf("apPodPattern returned error: %v", err)
			}
			re, err := regexp.Compile("^(?:" + pattern + ")$")
			if err != nil {
				t.Fatalf("pattern %q does not compile: %v", pattern, err)
			}
			for _, pod := range tc.hit {
				if !re.MatchString(pod) {
					t.Errorf("pattern %q must match %q", pattern, pod)
				}
			}
			for _, pod := range tc.miss {
				if re.MatchString(pod) {
					t.Errorf("pattern %q must not match %q", pattern, pod)
				}
			}
		})
	}
}

func TestAPMetricQueryEmbedsBoundedPodPattern(t *testing.T) {
	query, err := APMetricQuery(APMetricCPU, "project-a", "billing-api", APWorkloadDeployment)
	if err != nil {
		t.Fatalf("APMetricQuery returned error: %v", err)
	}
	want := `pod=~"billing-api-[a-z0-9]+-[a-z0-9]+"`
	if !strings.Contains(query, want) {
		t.Fatalf("query missing bounded pod matcher %s: %s", want, query)
	}
	if strings.Contains(query, ".*") {
		t.Fatalf("query must not fall back to an unbounded prefix wildcard: %s", query)
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
