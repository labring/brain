import "server-only";

import {
  type WorkspaceDetailsResponse,
  workspaceDetailsRequestSchema,
} from "../workspace-details-schema";
import { WORKSPACE_ERROR_CODES } from "../workspace-errors";
import {
  desktopFailureLogFields,
  desktopFailureResponse,
  type WorkspaceRouteDependencies,
  workspaceErrorResponse,
  workspaceJsonResponse,
  workspaceRouteContext,
} from "./workspace-route-context";
import { WORKSPACE_ROUTES } from "./workspace-route-table";

/**
 * `POST /api/workspace/details { uid }` (spec §B.2): Desktop's
 * `namespace/details` for the regional token on the request, answered as
 * `{ workspace, members }` in Brain's shape. Desktop is the authority on
 * membership — a caller outside the Workspace gets its 404, translated.
 */

/** The request body must be JSON; absent or blank is `{}` (then invalid). */
async function requestPayload(request: Request): Promise<unknown | null> {
  const text = (await request.text().catch(() => null))?.trim() ?? "";
  if (text === "") {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function createWorkspaceDetailsHandler(
  dependencies: WorkspaceRouteDependencies = {}
): (request: Request) => Promise<Response> {
  return async function handler(request: Request): Promise<Response> {
    const context = workspaceRouteContext(
      request,
      dependencies,
      WORKSPACE_ROUTES.details.apiPath
    );
    if (!context.ok) {
      return context.response;
    }
    const payload = await requestPayload(request);
    const parsed =
      payload == null ? null : workspaceDetailsRequestSchema.safeParse(payload);
    if (parsed == null || !parsed.success) {
      return workspaceErrorResponse(WORKSPACE_ERROR_CODES.invalidRequest, 400);
    }
    const result = await context.desktop.namespaceDetails(
      context.regionalToken,
      parsed.data.uid
    );
    if (!result.ok) {
      context.log("Desktop details failed", desktopFailureLogFields(result));
      return desktopFailureResponse(result);
    }
    const response: WorkspaceDetailsResponse = {
      members: result.data.members,
      workspace: result.data.workspace,
    };
    return workspaceJsonResponse(response);
  };
}
