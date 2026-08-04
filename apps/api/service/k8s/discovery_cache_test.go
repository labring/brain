package k8s

import (
	"errors"
	"testing"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/discovery"
	fakediscovery "k8s.io/client-go/discovery/fake"
	kubefake "k8s.io/client-go/kubernetes/fake"
)

// countingDiscovery hides the fake's concrete type so the mem cache client
// takes the legacy ServerGroups path, letting the test count real fetches.
type countingDiscovery struct {
	discovery.DiscoveryInterface
	fetches int
	fail    bool
}

func (c *countingDiscovery) ServerGroups() (*metav1.APIGroupList, error) {
	if c.fail {
		return nil, errors.New("cluster unreachable")
	}
	c.fetches++
	return c.DiscoveryInterface.ServerGroups()
}

func newDiscoveryFixture(t *testing.T) (*discoveryCache, *countingDiscovery, *fakediscovery.FakeDiscovery, *time.Time) {
	t.Helper()
	fake, ok := kubefake.NewSimpleClientset().Discovery().(*fakediscovery.FakeDiscovery)
	if !ok {
		t.Fatal("fake clientset discovery is not *fakediscovery.FakeDiscovery")
	}
	fake.Resources = []*metav1.APIResourceList{
		{
			GroupVersion: "v1",
			APIResources: []metav1.APIResource{
				{Name: "pods", SingularName: "pod", ShortNames: []string{"po"}, Namespaced: true, Kind: "Pod"},
			},
		},
		{
			GroupVersion: "apps.kubeblocks.io/v1",
			APIResources: []metav1.APIResource{
				{Name: "clusters", SingularName: "cluster", Namespaced: true, Kind: "Cluster"},
			},
		},
	}
	counting := &countingDiscovery{DiscoveryInterface: fake}
	current := time.Unix(1_700_000_000, 0)
	cache := newDiscoveryCache()
	cache.now = func() time.Time { return current }
	return cache, counting, fake, &current
}

func TestDiscoveryCacheResolvesFromOneFetch(t *testing.T) {
	cache, counting, _, _ := newDiscoveryFixture(t)

	for _, name := range []string{"pods", "pod", "po", "clusters", "cluster"} {
		gvr, namespaced, err := cache.resolveResource("host-a", counting, name)
		if err != nil {
			t.Fatalf("resolve %q: %v", name, err)
		}
		if !namespaced {
			t.Fatalf("resolve %q: expected namespaced", name)
		}
		if gvr.Resource != "pods" && gvr.Resource != "clusters" {
			t.Fatalf("resolve %q: unexpected gvr %v", name, gvr)
		}
	}
	if counting.fetches != 1 {
		t.Fatalf("expected 1 fetch across all lookups, got %d", counting.fetches)
	}

	gvr, _, err := cache.resolveResource("host-a", counting, "clusters")
	if err != nil {
		t.Fatalf("resolve clusters: %v", err)
	}
	want := schema.GroupVersionResource{Group: "apps.kubeblocks.io", Version: "v1", Resource: "clusters"}
	if gvr != want {
		t.Fatalf("resolve clusters: got %v, want %v", gvr, want)
	}
}

func TestDiscoveryCacheRefreshesAfterTTL(t *testing.T) {
	cache, counting, _, current := newDiscoveryFixture(t)

	if _, _, err := cache.resolveResource("host-a", counting, "pods"); err != nil {
		t.Fatalf("resolve: %v", err)
	}
	*current = current.Add(discoveryCacheTTL + time.Second)
	if _, _, err := cache.resolveResource("host-a", counting, "pods"); err != nil {
		t.Fatalf("resolve after TTL: %v", err)
	}
	if counting.fetches != 2 {
		t.Fatalf("expected TTL expiry to refetch, got %d fetches", counting.fetches)
	}
}

func TestDiscoveryCacheMissRefreshRespectsCooldown(t *testing.T) {
	cache, counting, fake, current := newDiscoveryFixture(t)

	_, _, err := cache.resolveResource("host-a", counting, "widgets")
	if !IsUnknownResourceError(err, "widgets") {
		t.Fatalf("expected unknown resource error, got %v", err)
	}
	if counting.fetches != 1 {
		t.Fatalf("miss inside cooldown must not refetch, got %d fetches", counting.fetches)
	}

	fake.Resources = append(fake.Resources, &metav1.APIResourceList{
		GroupVersion: "example.io/v1",
		APIResources: []metav1.APIResource{{Name: "widgets", Namespaced: true, Kind: "Widget"}},
	})
	*current = current.Add(discoveryMissRefreshCooldown + time.Second)
	gvr, _, err := cache.resolveResource("host-a", counting, "widgets")
	if err != nil {
		t.Fatalf("resolve after CRD install: %v", err)
	}
	if gvr.Group != "example.io" {
		t.Fatalf("unexpected gvr %v", gvr)
	}
	if counting.fetches != 2 {
		t.Fatalf("expected exactly one miss-triggered refetch, got %d", counting.fetches)
	}
}

func TestDiscoveryCacheServesStaleOnRefreshFailure(t *testing.T) {
	cache, counting, _, current := newDiscoveryFixture(t)

	if _, _, err := cache.resolveResource("host-a", counting, "pods"); err != nil {
		t.Fatalf("resolve: %v", err)
	}
	counting.fail = true
	*current = current.Add(discoveryCacheTTL + time.Second)
	if _, _, err := cache.resolveResource("host-a", counting, "pods"); err != nil {
		t.Fatalf("expected stale data to be served on refresh failure, got %v", err)
	}
}

func TestDiscoveryCacheRESTMapperRefreshFindsNewKind(t *testing.T) {
	cache, counting, fake, current := newDiscoveryFixture(t)

	mapper, err := cache.restMapper("host-a", counting)
	if err != nil {
		t.Fatalf("restMapper: %v", err)
	}
	mapping, err := mapper.RESTMapping(schema.GroupKind{Group: "apps.kubeblocks.io", Kind: "Cluster"}, "v1")
	if err != nil {
		t.Fatalf("RESTMapping known kind: %v", err)
	}
	if mapping.Resource.Resource != "clusters" {
		t.Fatalf("unexpected mapping %v", mapping.Resource)
	}
	if _, err := mapper.RESTMapping(schema.GroupKind{Group: "example.io", Kind: "Widget"}, "v1"); err == nil {
		t.Fatal("expected no-match for unknown kind")
	}

	fake.Resources = append(fake.Resources, &metav1.APIResourceList{
		GroupVersion: "example.io/v1",
		APIResources: []metav1.APIResource{{Name: "widgets", Namespaced: true, Kind: "Widget"}},
	})
	*current = current.Add(discoveryMissRefreshCooldown + time.Second)
	refreshed, err := cache.refreshedRESTMapper("host-a", counting)
	if err != nil {
		t.Fatalf("refreshedRESTMapper: %v", err)
	}
	if _, err := refreshed.RESTMapping(schema.GroupKind{Group: "example.io", Kind: "Widget"}, "v1"); err != nil {
		t.Fatalf("RESTMapping after refresh: %v", err)
	}
}

func TestDiscoveryCacheIsolatesHosts(t *testing.T) {
	cache, counting, _, _ := newDiscoveryFixture(t)

	if _, _, err := cache.resolveResource("host-a", counting, "pods"); err != nil {
		t.Fatalf("resolve host-a: %v", err)
	}
	if _, _, err := cache.resolveResource("host-b", counting, "pods"); err != nil {
		t.Fatalf("resolve host-b: %v", err)
	}
	if counting.fetches != 2 {
		t.Fatalf("expected one fetch per host, got %d", counting.fetches)
	}
}
