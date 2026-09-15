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
  delete: {
    apiPath: "/api/workspace/delete",
    desktopPath: "/api/auth/namespace/delete",
  },
  details: {
    apiPath: "/api/workspace/details",
    desktopPath: "/api/auth/namespace/details",
  },
  inviteLink: {
    apiPath: "/api/workspace/invite-link",
    desktopPath: "/api/auth/namespace/getInviteCode",
  },
  list: {
    apiPath: "/api/workspace/list",
    desktopPath: "/api/auth/namespace/list",
  },
  memberAlias: {
    apiPath: "/api/workspace/member/alias",
    desktopPath: "/api/auth/namespace/setAlias",
  },
  memberRemove: {
    apiPath: "/api/workspace/member/remove",
    desktopPath: "/api/auth/namespace/removeUser",
  },
  memberRole: {
    apiPath: "/api/workspace/member/role",
    desktopPath: "/api/auth/namespace/modifyRole",
  },
  rename: {
    apiPath: "/api/workspace/rename",
    desktopPath: "/api/auth/namespace/rename",
  },
  transfer: {
    apiPath: "/api/workspace/transfer",
    desktopPath: "/api/auth/namespace/abdicate",
  },
} as const satisfies Record<string, WorkspaceRouteEntry>;
