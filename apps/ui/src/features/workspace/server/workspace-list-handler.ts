import "server-only";

import {
  desktopFailureLogFields,
  desktopFailureResponse,
  type WorkspaceRouteDependencies,
  workspaceJsonResponse,
  workspaceRouteContext,
} from "./workspace-route-context";
import { WORKSPACE_ROUTES } from "./workspace-route-table";

/**
 * `GET /api/workspace/list` (spec §B.2): Desktop's `namespace/list` for the
 * regional token on the request, answered in the Brain Session's Workspace
 * shape and Desktop's order. The Workspace Switcher keeps its list fresh
 * through this route, with the session's list as the fallback.
 */
export function createWorkspaceListHandler(
  dependencies: WorkspaceRouteDependencies = {}
): (request: Request) => Promise<Response> {
  return async function handler(request: Request): Promise<Response> {
    const context = workspaceRouteContext(
      request,
      dependencies,
      WORKSPACE_ROUTES.list.apiPath
    );
    if (!context.ok) {
      return context.response;
    }
    const result = await context.desktop.namespaceList(context.regionalToken);
    if (!result.ok) {
      context.log("Desktop list failed", desktopFailureLogFields(result));
      return desktopFailureResponse(result);
    }
    return workspaceJsonResponse(result.data);
  };
}
