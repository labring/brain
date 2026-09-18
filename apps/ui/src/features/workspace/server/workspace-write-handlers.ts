import "server-only";

import type { z } from "zod";

import type { DesktopAuthApi } from "@/features/session/server/desktop-auth-api";
import type { DesktopCallResult } from "@/features/session/server/desktop-client";

import { WORKSPACE_ERROR_CODES } from "../workspace-errors";
import {
  WORKSPACE_WRITE_OK,
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
 * Desktop's `getInviteCode` rejects Owner but lets a Manager mint a Manager
 * link — the same class of hole the schema's never-Owner closes — so Brain
 * closes it itself (spec §E.4): a Manager link requires an Owner actor,
 * proven by the actor's own membership from `namespace/list`. Developer
 * links need no extra call; Desktop gates them for Managers too.
 */
export function createWorkspaceInviteLinkHandler(
  dependencies: WorkspaceRouteDependencies = {}
): WorkspaceRouteHandler {
  return async function handler(request: Request): Promise<Response> {
    const context = workspaceRouteContext(
      request,
      dependencies,
      WORKSPACE_ROUTES.inviteLink.apiPath
    );
    if (!context.ok) {
      return context.response;
    }
    const payload = await workspaceRequestPayload(request);
    const parsed =
      payload == null
        ? null
        : workspaceInviteLinkRequestSchema.safeParse(payload);
    if (parsed == null || !parsed.success) {
      return workspaceErrorResponse(WORKSPACE_ERROR_CODES.invalidRequest, 400);
    }
    const body = parsed.data;
    if (body.role === "Manager") {
      const listed = await context.desktop.namespaceList(context.regionalToken);
      if (!listed.ok) {
        context.log("Desktop list failed", {
          ...desktopFailureLogFields(listed),
          desktopPath: WORKSPACE_ROUTES.list.desktopPath,
        });
        return desktopFailureResponse(listed);
      }
      const actorRole = listed.data.find(
        (workspace) => workspace.uid === body.uid
      )?.role;
      if (actorRole !== "Owner") {
        context.log("non-Owner actor tried to mint a Manager invite", {
          actorRole: actorRole ?? "none",
        });
        return workspaceErrorResponse(WORKSPACE_ERROR_CODES.forbidden, 403);
      }
    }
    const result = await context.desktop.namespaceInviteCode(
      context.regionalToken,
      body.uid,
      body.role
    );
    if (!result.ok) {
      context.log("Desktop write failed", {
        ...desktopFailureLogFields(result),
        desktopPath: WORKSPACE_ROUTES.inviteLink.desktopPath,
      });
      return desktopFailureResponse(result);
    }
    return workspaceJsonResponse({ code: result.data.code });
  };
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
