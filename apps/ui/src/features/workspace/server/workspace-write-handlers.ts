import "server-only";

import type { z } from "zod";

import type { DesktopAuthApi } from "@/features/session/server/desktop-auth-api";
import type { DesktopCallResult } from "@/features/session/server/desktop-client";

import { WORKSPACE_ERROR_CODES } from "../workspace-errors";
import {
  WORKSPACE_WRITE_OK,
  type WorkspaceInviteLinkResponse,
  workspaceDeleteRequestSchema,
  workspaceInviteLinkRequestSchema,
  workspaceMemberAliasRequestSchema,
  workspaceMemberRemoveRequestSchema,
  workspaceMemberRoleRequestSchema,
  workspaceRenameRequestSchema,
  workspaceTransferRequestSchema,
} from "../workspace-write-schema";
import {
  desktopFailureLogFields,
  desktopFailureResponse,
  type WorkspaceRouteDependencies,
  workspaceErrorResponse,
  workspaceJsonResponse,
  workspaceRequestPayload,
  workspaceRouteContext,
} from "./workspace-route-context";
import {
  WORKSPACE_ROUTES,
  type WorkspaceRouteEntry,
} from "./workspace-route-table";

/**
 * The Workspace-management write routes (spec §B.2), one handler each and
 * one shape between them: the shared preamble (regional token → 401,
 * Desktop client from the environment), the route's zod body, one Desktop
 * call, Desktop's envelope code translated into a real status with Brain's
 * own error code, and Brain's own success body. Brain judges no permission
 * here — Desktop is the sole authority — and the schemas close the holes
 * Desktop leaves open (a role is never Owner).
 */

type WorkspaceRouteHandler = (request: Request) => Promise<Response>;

function createWorkspaceWriteHandler<TBody, TData>(
  entry: WorkspaceRouteEntry,
  requestSchema: z.ZodType<TBody, unknown>,
  call: (
    desktop: DesktopAuthApi,
    regionalToken: string,
    body: TBody
  ) => Promise<DesktopCallResult<TData>>,
  respond: (data: TData) => unknown,
  dependencies: WorkspaceRouteDependencies
): WorkspaceRouteHandler {
  return async function handler(request: Request): Promise<Response> {
    const context = workspaceRouteContext(request, dependencies, entry.apiPath);
    if (!context.ok) {
      return context.response;
    }
    const payload = await workspaceRequestPayload(request);
    const parsed = payload == null ? null : requestSchema.safeParse(payload);
    if (parsed == null || !parsed.success) {
      return workspaceErrorResponse(WORKSPACE_ERROR_CODES.invalidRequest, 400);
    }
    const result = await call(
      context.desktop,
      context.regionalToken,
      parsed.data
    );
    if (!result.ok) {
      context.log("Desktop write failed", {
        ...desktopFailureLogFields(result),
        desktopPath: entry.desktopPath,
      });
      return desktopFailureResponse(result);
    }
    return workspaceJsonResponse(respond(result.data));
  };
}

/** `POST /api/workspace/rename { uid, name }` → `namespace/rename`. */
export function createWorkspaceRenameHandler(
  dependencies: WorkspaceRouteDependencies = {}
): WorkspaceRouteHandler {
  return createWorkspaceWriteHandler(
    WORKSPACE_ROUTES.rename,
    workspaceRenameRequestSchema,
    (desktop, token, body) =>
      desktop.namespaceRename(token, body.uid, body.name),
    () => WORKSPACE_WRITE_OK,
    dependencies
  );
}

/** `POST /api/workspace/delete { uid }` → `namespace/delete`. */
export function createWorkspaceDeleteHandler(
  dependencies: WorkspaceRouteDependencies = {}
): WorkspaceRouteHandler {
  return createWorkspaceWriteHandler(
    WORKSPACE_ROUTES.delete,
    workspaceDeleteRequestSchema,
    (desktop, token, body) => desktop.namespaceDelete(token, body.uid),
    () => WORKSPACE_WRITE_OK,
    dependencies
  );
}

/**
 * `POST /api/workspace/invite-link { uid, role }` → `namespace/getInviteCode`,
 * answered as `{ code }`; the client builds the Desktop link around it.
 */
export function createWorkspaceInviteLinkHandler(
  dependencies: WorkspaceRouteDependencies = {}
): WorkspaceRouteHandler {
  return createWorkspaceWriteHandler(
    WORKSPACE_ROUTES.inviteLink,
    workspaceInviteLinkRequestSchema,
    (desktop, token, body) =>
      desktop.namespaceInviteCode(token, body.uid, body.role),
    (data): WorkspaceInviteLinkResponse => ({ code: data.code }),
    dependencies
  );
}

/** `POST /api/workspace/member/remove { uid, crUid }` → `namespace/removeUser`. */
export function createWorkspaceMemberRemoveHandler(
  dependencies: WorkspaceRouteDependencies = {}
): WorkspaceRouteHandler {
  return createWorkspaceWriteHandler(
    WORKSPACE_ROUTES.memberRemove,
    workspaceMemberRemoveRequestSchema,
    (desktop, token, body) =>
      desktop.namespaceRemoveUser(token, body.uid, body.crUid),
    () => WORKSPACE_WRITE_OK,
    dependencies
  );
}

/** `POST /api/workspace/member/role { uid, crUid, role }` → `namespace/modifyRole`. */
export function createWorkspaceMemberRoleHandler(
  dependencies: WorkspaceRouteDependencies = {}
): WorkspaceRouteHandler {
  return createWorkspaceWriteHandler(
    WORKSPACE_ROUTES.memberRole,
    workspaceMemberRoleRequestSchema,
    (desktop, token, body) =>
      desktop.namespaceModifyRole(token, body.uid, body.crUid, body.role),
    () => WORKSPACE_WRITE_OK,
    dependencies
  );
}

/** `POST /api/workspace/member/alias { uid, crUid, alias }` → `namespace/setAlias`. */
export function createWorkspaceMemberAliasHandler(
  dependencies: WorkspaceRouteDependencies = {}
): WorkspaceRouteHandler {
  return createWorkspaceWriteHandler(
    WORKSPACE_ROUTES.memberAlias,
    workspaceMemberAliasRequestSchema,
    (desktop, token, body) =>
      desktop.namespaceSetAlias(token, body.uid, body.crUid, body.alias),
    () => WORKSPACE_WRITE_OK,
    dependencies
  );
}

/** `POST /api/workspace/transfer { uid, crUid }` → `namespace/abdicate`. */
export function createWorkspaceTransferHandler(
  dependencies: WorkspaceRouteDependencies = {}
): WorkspaceRouteHandler {
  return createWorkspaceWriteHandler(
    WORKSPACE_ROUTES.transfer,
    workspaceTransferRequestSchema,
    (desktop, token, body) =>
      desktop.namespaceAbdicate(token, body.uid, body.crUid),
    () => WORKSPACE_WRITE_OK,
    dependencies
  );
}
