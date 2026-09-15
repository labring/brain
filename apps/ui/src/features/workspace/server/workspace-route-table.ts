/**
 * Single source of truth for the /api/workspace/* route surface (spec §B.2,
 * mirroring the billing table): each route's public path and the Desktop
 * `/api/auth/*` path it calls. Route handlers take their Desktop path from
 * here, the dev-mock dispatcher answers routes by it, and the guard test in
 * workspace-route-table.test.ts cross-checks entries against the route
 * files on disk, so the mapping can never drift silently.
 */

export interface WorkspaceRouteEntry {
  /** Public route path served by this app, e.g. "/api/workspace/list". */
  apiPath: string;
  /** Desktop route the handler calls; also the dev-mock dispatch key. */
  desktopPath: string;
}

export const WORKSPACE_ROUTES = {
  details: {
    apiPath: "/api/workspace/details",
    desktopPath: "/api/auth/namespace/details",
  },
  list: {
    apiPath: "/api/workspace/list",
    desktopPath: "/api/auth/namespace/list",
  },
} as const satisfies Record<string, WorkspaceRouteEntry>;
