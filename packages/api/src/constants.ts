/**
 * HTTP pathnames served by `apps/api`, typically reached through the UI app's
 * same-origin `/api/...` proxy in the browser.
 *
 * **Trailing-slash note:** Huma + chi register group-root operations (e.g.
 * `Path: "/"` under `/api/ap/v1alpha1`) at paths ending with `/`. The Go API
 * uses a middleware (`appendSlashForGroupRoots`) to accept both variants, so
 * constants here use clean paths without trailing slashes.
 */
export const API_ROUTES = {
  /** Main process health (`main.go`). */
  health: "/health",
  docs: "/docs",

  k8s: {
    base: "/api/k8s/v1alpha1",
    health: "/api/k8s/v1alpha1/health",
    get: "/api/k8s/v1alpha1/get",
    /** GET `/` alias for {@link API_ROUTES.k8s.get} (hidden in OpenAPI). */
    getRoot: "/api/k8s/v1alpha1",
    describe: "/api/k8s/v1alpha1/describe",
    logs: "/api/k8s/v1alpha1/logs",
    exec: "/api/k8s/v1alpha1/exec",
    top: "/api/k8s/v1alpha1/top",
    apply: "/api/k8s/v1alpha1/apply",
    delete: "/api/k8s/v1alpha1/delete",
    patch: "/api/k8s/v1alpha1/patch",
    scale: "/api/k8s/v1alpha1/scale",
    autoscale: "/api/k8s/v1alpha1/autoscale",
    rollout: "/api/k8s/v1alpha1/rollout",
  },

  ap: {
    base: "/api/ap/v1alpha1",
    /** GET list/get, PUT create, PATCH update, DELETE — group root. */
    root: "/api/ap/v1alpha1",
    /** Recent Kubernetes events for one AP workload. */
    events: "/api/ap/v1alpha1/events",
    /** Explicitly reveal/copy one saved AP environment row value. */
    envValue: "/api/ap/v1alpha1/env-value",
    /** Image version history for one AP workload. */
    versions: "/api/ap/v1alpha1/versions",
    /** Rollout-restart the composed Deployment (same name as the AP). */
    restart: "/api/ap/v1alpha1/restart",
    /** Real external reachability check for AP Public Addresses. */
    checkReady: "/api/ap/v1alpha1/check-ready",
  },

  db: {
    base: "/api/db/v1alpha1",
    /** GET list/get, PUT create, PATCH update, DELETE — group root. */
    root: "/api/db/v1alpha1",
    /**
     * Explicitly reveal/copy one complete DB Connection DSN. Default DB read
     * responses carry credential-free DB Connection Templates (ADR-0052).
     */
    connectionString: "/api/db/v1alpha1/connection-string",
    backup: "/api/db/v1alpha1/backup",
    restart: "/api/db/v1alpha1/restart",
    start: "/api/db/v1alpha1/start",
    stop: "/api/db/v1alpha1/stop",
  },

  telemetry: {
    base: "/api/telemetry/v1alpha1",
    logsHealth: "/api/telemetry/v1alpha1/logs/health",
    logs: "/api/telemetry/v1alpha1/logs",
    metricsHealth: "/api/telemetry/v1alpha1/metrics/health",
    metricsSnapshot: "/api/telemetry/v1alpha1/metrics/snapshot",
    metricsSeries: "/api/telemetry/v1alpha1/metrics/series",
  },
} as const;

type ApiRouteLeaf<T> = T extends string
  ? T
  : T extends object
    ? ApiRouteLeaf<T[keyof T]>
    : never;

/** Every path string in {@link API_ROUTES} (for SWR keys, route guards, etc.). */
export type ApiRoute = ApiRouteLeaf<typeof API_ROUTES>;
