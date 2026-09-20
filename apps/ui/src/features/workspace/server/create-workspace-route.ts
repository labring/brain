import type { WorkspaceRouteEntry } from "./workspace-route-table";

type WorkspaceRouteHandler = (request: Request) => Promise<Response>;

/**
 * Lets the session dev-mock dispatcher answer a `/api/workspace/*` route
 * first in dev and demo builds (spec §B.4): the same cookie that serves
 * `POST /api/session` from fixtures serves the Workspace routes, so one
 * scenario shapes the session and the Switcher together. The gate is
 * inlined (as in `withSessionDevMock`) because a shared helper call would
 * not be statically dropped from production bundles.
 */
export function withWorkspaceDevMock(
  entry: WorkspaceRouteEntry,
  handler: WorkspaceRouteHandler
): WorkspaceRouteHandler {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.NEXT_PUBLIC_DEV_TWEAKS !== "1"
  ) {
    return handler;
  }
  return async (request) => {
    const { workspaceDevMockResponse } = await import(
      "@/features/session/server/dev-fixtures"
    );
    const mocked = await workspaceDevMockResponse(entry.desktopPath, request);
    return mocked ?? handler(request);
  };
}
