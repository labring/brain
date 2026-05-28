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
    nsconfig: "/api/k8s/v1alpha1/nsconfig",
  },

  /**
   * Project claims + share-token preview (`/api/projects/v1alpha1` in `apps/api/route/project`).
   */
  projects: {
    base: "/api/projects/v1alpha1",
    share: "/api/projects/v1alpha1/share",
  },

  ap: {
    base: "/api/ap/v1alpha1",
    /** GET list/get, PUT create, PATCH update, DELETE — group root. */
    root: "/api/ap/v1alpha1",
    /** Recent Kubernetes events for one AP workload. */
    events: "/api/ap/v1alpha1/events",
    /** Rollout-restart the composed Deployment (same name as the AP). */
    restart: "/api/ap/v1alpha1/restart",
  },

  db: {
    base: "/api/db/v1alpha1",
    /** GET list/get, PUT create, PATCH update, DELETE — group root. */
    root: "/api/db/v1alpha1",
    backup: "/api/db/v1alpha1/backup",
    restart: "/api/db/v1alpha1/restart",
    start: "/api/db/v1alpha1/start",
    stop: "/api/db/v1alpha1/stop",
  },

  entrypoint: {
    base: "/api/entrypoint/v1alpha1",
    /** GET list/get — group root. */
    root: "/api/entrypoint/v1alpha1",
  },

  task: {
    base: "/api/task/v1alpha1",
    s2i: "/api/task/v1alpha1/s2i",
  },

  telemetry: {
    base: "/api/telemetry/v1alpha1",
    logsHealth: "/api/telemetry/v1alpha1/logs/health",
    logs: "/api/telemetry/v1alpha1/logs",
    metricsHealth: "/api/telemetry/v1alpha1/metrics/health",
    metricsSnapshot: "/api/telemetry/v1alpha1/metrics/snapshot",
    metricsSeries: "/api/telemetry/v1alpha1/metrics/series",
  },

  /**
   * Region JWT → encoded kubeconfig via cluster Ingress `sealos-desktop` (`/api/auth/v1alpha1` in `apps/api/route/auth`).
   */
  auth: {
    base: "/api/auth/v1alpha1",
    regionToken: "/api/auth/v1alpha1/regionToken",
  },
} as const;

type ApiRouteLeaf<T> = T extends string
  ? T
  : T extends object
    ? ApiRouteLeaf<T[keyof T]>
    : never;

/** Every path string in {@link API_ROUTES} (for SWR keys, route guards, etc.). */
export type ApiRoute = ApiRouteLeaf<typeof API_ROUTES>;
