import { WORKSPACE_ROUTES } from "./server/workspace-route-table";
import type { WorkspaceMember } from "./workspace-details-schema";
import { postWorkspaceJson } from "./workspace-request";
import {
  type AssignableRole,
  type WorkspaceInviteLinkResponse,
  type WorkspaceWriteResponse,
  workspaceInviteLinkResponseSchema,
  workspaceWriteResponseSchema,
} from "./workspace-write-schema";

/**
 * The Workspace-management writes (spec §B.2) as the page calls them: one
 * function per route, the body in Brain's own shape, the answer validated.
 * Desktop stays the authority — these carry no permission judgment; the
 * gates decide what is offered, Desktop's 403 / 404 corrects a stale page.
 */

export function renameWorkspace(input: {
  name: string;
  uid: string;
}): Promise<WorkspaceWriteResponse> {
  return postWorkspaceJson(
    WORKSPACE_ROUTES.rename.apiPath,
    input,
    workspaceWriteResponseSchema
  );
}

export function deleteWorkspace(input: {
  uid: string;
}): Promise<WorkspaceWriteResponse> {
  return postWorkspaceJson(
    WORKSPACE_ROUTES.delete.apiPath,
    input,
    workspaceWriteResponseSchema
  );
}

export function createWorkspaceInviteLink(input: {
  role: AssignableRole;
  uid: string;
}): Promise<WorkspaceInviteLinkResponse> {
  return postWorkspaceJson(
    WORKSPACE_ROUTES.inviteLink.apiPath,
    input,
    workspaceInviteLinkResponseSchema
  );
}

/** Removing the actor's own membership is leaving (spec §E.3). */
export function removeWorkspaceMember(input: {
  crUid: WorkspaceMember["crUid"];
  uid: string;
}): Promise<WorkspaceWriteResponse> {
  return postWorkspaceJson(
    WORKSPACE_ROUTES.memberRemove.apiPath,
    input,
    workspaceWriteResponseSchema
  );
}

export function changeWorkspaceMemberRole(input: {
  crUid: WorkspaceMember["crUid"];
  role: AssignableRole;
  uid: string;
}): Promise<WorkspaceWriteResponse> {
  return postWorkspaceJson(
    WORKSPACE_ROUTES.memberRole.apiPath,
    input,
    workspaceWriteResponseSchema
  );
}

/** An alias left empty is sent as null: clear it (spec §B.2, §D.5). */
export function setWorkspaceMemberAlias(input: {
  alias: string;
  crUid: WorkspaceMember["crUid"];
  uid: string;
}): Promise<WorkspaceWriteResponse> {
  const alias = input.alias.trim();
  return postWorkspaceJson(
    WORKSPACE_ROUTES.memberAlias.apiPath,
    { alias: alias === "" ? null : alias, crUid: input.crUid, uid: input.uid },
    workspaceWriteResponseSchema
  );
}

export function transferWorkspaceOwnership(input: {
  crUid: WorkspaceMember["crUid"];
  uid: string;
}): Promise<WorkspaceWriteResponse> {
  return postWorkspaceJson(
    WORKSPACE_ROUTES.transfer.apiPath,
    input,
    workspaceWriteResponseSchema
  );
}
