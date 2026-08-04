package k8s

import (
	"fmt"
	"strings"
	"sync"
	"time"

	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/discovery/cached/memory"
	"k8s.io/client-go/restmapper"
)

// Discovery answers ("which resources does this cluster serve, in which
// group/version") are cluster-global: every authenticated principal sees the
// same API surface and no object or user data is involved, so entries are
// shared across requests and users, keyed by API server host. Only parsed
// discovery data is stored — refreshes always run with the requesting
// client's credentials, never with credentials captured at fill time.
const (
	// discoveryCacheTTL bounds staleness from cluster upgrades and operator
	// installs, which are the only events that change discovery data.
	discoveryCacheTTL = 10 * time.Minute
	// discoveryMissRefreshCooldown rate-limits repeated miss-triggered
	// refreshes so lookups of a bogus name cannot hammer the API server.
	// The first miss after a successful refresh is never throttled: a
	// just-installed CRD must resolve immediately.
	discoveryMissRefreshCooldown = 30 * time.Second
	// discoveryRefreshFailureBackoff is how long the stale snapshot keeps
	// being served without re-attempting after a failed refresh, so an
	// apiserver discovery outage is not amplified by every request retrying.
	discoveryRefreshFailureBackoff = 15 * time.Second
)

var sharedDiscovery = newDiscoveryCache()

type discoveryCacheEntry struct {
	mu             sync.Mutex
	lists          []*metav1.APIResourceList
	groupResources []*restmapper.APIGroupResources
	// fetchedAt is the last successful refresh, attemptedAt the last refresh
	// attempt (failed ones included), and missRefreshAt the last refresh
	// triggered by a lookup miss — tracked separately so throttling repeated
	// misses never delays the refresh that follows a normal TTL expiry.
	fetchedAt     time.Time
	attemptedAt   time.Time
	missRefreshAt time.Time
	// partial marks a snapshot that is missing groups whose discovery failed
	// (e.g. a stale aggregated API, or a per-identity Forbidden). A partial
	// snapshot must not suppress miss refreshes for long: the missing name
	// may live in a failed group another identity can read.
	partial bool
}

type discoveryCache struct {
	mu      sync.Mutex
	entries map[string]*discoveryCacheEntry
	now     func() time.Time
}

func newDiscoveryCache() *discoveryCache {
	return &discoveryCache{entries: map[string]*discoveryCacheEntry{}, now: time.Now}
}

func (c *discoveryCache) entry(host string) *discoveryCacheEntry {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.entries[host]
	if !ok {
		e = &discoveryCacheEntry{}
		c.entries[host] = e
	}
	return e
}

// resolveResource maps a resource name, singular name, or short name to its
// preferred GroupVersionResource and whether it is namespaced.
func (c *discoveryCache) resolveResource(host string, d discovery.DiscoveryInterface, resource string) (schema.GroupVersionResource, bool, error) {
	resource = strings.ToLower(strings.TrimSpace(resource))
	if resource == "" {
		return schema.GroupVersionResource{}, false, fmt.Errorf("resource cannot be empty")
	}
	e := c.entry(host)
	e.mu.Lock()
	defer e.mu.Unlock()
	if err := e.ensureFreshLocked(d, c.now()); err != nil {
		return schema.GroupVersionResource{}, false, err
	}
	if gvr, namespaced, ok := findResourceInLists(e.lists, resource); ok {
		return gvr, namespaced, nil
	}
	// The name may belong to a CRD installed after the last refresh; refresh
	// before deciding it is unknown.
	if e.refreshForMissLocked(d, c.now()) {
		if gvr, namespaced, ok := findResourceInLists(e.lists, resource); ok {
			return gvr, namespaced, nil
		}
	}
	return schema.GroupVersionResource{}, false, UnknownResourceError{Resource: resource}
}

// restMapper returns a GVK-to-GVR mapper built from the cached discovery data.
func (c *discoveryCache) restMapper(host string, d discovery.DiscoveryInterface) (meta.RESTMapper, error) {
	e := c.entry(host)
	e.mu.Lock()
	defer e.mu.Unlock()
	if err := e.ensureFreshLocked(d, c.now()); err != nil {
		return nil, err
	}
	return restmapper.NewDiscoveryRESTMapper(e.groupResources), nil
}

// refreshedRESTMapper is the no-match retry path for apply: the manifest may
// carry a kind newer than the cache, so refresh and rebuild.
func (c *discoveryCache) refreshedRESTMapper(host string, d discovery.DiscoveryInterface) (meta.RESTMapper, error) {
	e := c.entry(host)
	e.mu.Lock()
	defer e.mu.Unlock()
	e.refreshForMissLocked(d, c.now())
	if !e.hasDataLocked() {
		return nil, fmt.Errorf("no discovery data available for %s", host)
	}
	return restmapper.NewDiscoveryRESTMapper(e.groupResources), nil
}

func (e *discoveryCacheEntry) hasDataLocked() bool {
	return e.groupResources != nil
}

func (e *discoveryCacheEntry) ensureFreshLocked(d discovery.DiscoveryInterface, now time.Time) error {
	if e.hasDataLocked() {
		if now.Sub(e.fetchedAt) < discoveryCacheTTL {
			return nil
		}
		// TTL expired but the last attempt was recent, meaning it failed:
		// keep serving the stale snapshot for the backoff window instead of
		// letting every request re-run a doomed discovery.
		if now.Sub(e.attemptedAt) < discoveryRefreshFailureBackoff {
			return nil
		}
	}
	if err := e.refreshLocked(d, now); err != nil {
		// Serve the stale snapshot when a refresh fails: the resource
		// operation that follows will surface any real connectivity error.
		if e.hasDataLocked() {
			return nil
		}
		return err
	}
	return nil
}

// refreshForMissLocked refreshes after a lookup miss and reports whether a
// refresh ran and succeeded. The first miss after a successful refresh always
// refreshes so a just-installed CRD resolves immediately; repeated misses are
// throttled. A partial snapshot uses the shorter failure backoff as its
// throttle window so a name hidden by a failed group is retried sooner.
func (e *discoveryCacheEntry) refreshForMissLocked(d discovery.DiscoveryInterface, now time.Time) bool {
	cooldown := discoveryMissRefreshCooldown
	if e.partial {
		cooldown = discoveryRefreshFailureBackoff
	}
	if now.Sub(e.missRefreshAt) < cooldown {
		return false
	}
	e.missRefreshAt = now
	return e.refreshLocked(d, now) == nil
}

func (e *discoveryCacheEntry) refreshLocked(d discovery.DiscoveryInterface, now time.Time) error {
	e.attemptedAt = now
	// One mem cache client backs both derivations below so the cluster is
	// asked only once per refresh.
	cached := memory.NewMemCacheClient(d)
	lists, err := discovery.ServerPreferredResources(cached)
	if err != nil && !discovery.IsGroupDiscoveryFailedError(err) {
		return err
	}
	partial := discovery.IsGroupDiscoveryFailedError(err)
	// Partial discovery is OK (e.g. stale metrics.k8s.io); preferred lists still include CRDs like aps.
	if len(lists) == 0 {
		if err != nil {
			return err
		}
		return fmt.Errorf("cluster returned no discoverable resources")
	}
	groupResources, err := restmapper.GetAPIGroupResources(cached)
	if err != nil {
		return err
	}
	e.lists = lists
	e.groupResources = groupResources
	e.partial = partial
	e.fetchedAt = now
	return nil
}

func findResourceInLists(lists []*metav1.APIResourceList, resource string) (schema.GroupVersionResource, bool, bool) {
	for _, list := range lists {
		gv, err := schema.ParseGroupVersion(list.GroupVersion)
		if err != nil {
			continue
		}
		for _, r := range list.APIResources {
			if r.Name == resource || r.SingularName == resource {
				return gv.WithResource(r.Name), r.Namespaced, true
			}
			for _, short := range r.ShortNames {
				if short == resource {
					return gv.WithResource(r.Name), r.Namespaced, true
				}
			}
		}
	}
	return schema.GroupVersionResource{}, false, false
}
