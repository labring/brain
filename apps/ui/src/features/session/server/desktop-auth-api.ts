import "server-only";

import { z } from "zod";

import type { WorkspaceMember } from "@/features/workspace/workspace-details-schema";

import type { SessionWorkspace, WorkspaceRole } from "../session-schema";
import {
  type DesktopCallResult,
  type DesktopClient,
  encodedTokenAuthorization,
} from "./desktop-client";

/**
 * The Desktop `/api/auth/*` calls Brain makes: the four the Brain Session
 * needs (spec §A.1) and the Workspace-management reads (spec §B.2), typed
 * against the Desktop DTOs they answer with. Each takes the token in the
 * form Desktop's verifier expects — the global token for `regionToken`, the
 * regional token everywhere else — and returns the raw DTO, or, where the
 * shape is Brain's own, the transformed one.
 */

export const DESKTOP_AUTH_PATHS = {
  info: "/api/auth/info",
  namespaceAbdicate: "/api/auth/namespace/abdicate",
  namespaceCreate: "/api/auth/namespace/create",
  namespaceDelete: "/api/auth/namespace/delete",
  namespaceDetails: "/api/auth/namespace/details",
  namespaceInviteCode: "/api/auth/namespace/getInviteCode",
  namespaceList: "/api/auth/namespace/list",
  namespaceModifyRole: "/api/auth/namespace/modifyRole",
  namespaceRemoveUser: "/api/auth/namespace/removeUser",
  namespaceRename: "/api/auth/namespace/rename",
  namespaceSetAlias: "/api/auth/namespace/setAlias",
  namespaceSwitch: "/api/auth/namespace/switch",
  regionToken: "/api/auth/regionToken",
} as const;

const regionTokenDataSchema = z.object({
  appToken: z.string().min(1),
  kubeconfig: z.string().min(1),
  token: z.string().min(1),
});

export type RegionTokenData = z.infer<typeof regionTokenDataSchema>;

/** `UserRole { Owner = 0, Manager = 1, Developer = 2 }` in Desktop. */
const DESKTOP_ROLES: Record<number, WorkspaceRole> = {
  0: "Owner",
  1: "Manager",
  2: "Developer",
};

/** The role code Desktop's write routes take (`role`, `tRole`). */
const DESKTOP_ROLE_CODES: Record<WorkspaceRole, number> = {
  Developer: 2,
  Manager: 1,
  Owner: 0,
};

/** Desktop answers the write routes with `data: null`; nothing is read from it. */
const voidDataSchema = z.unknown().transform((): null => null);

const inviteCodeDataSchema = z.object({ code: z.string().min(1) });

export type InviteCodeData = z.infer<typeof inviteCodeDataSchema>;

/** `NSType { Team = 0, Private = 1 }` in Desktop. */
const DESKTOP_NSTYPE_PRIVATE = 1;

const namespaceDtoSchema = z.object({
  createTime: z.union([z.string(), z.number()]),
  id: z.string().min(1),
  nstype: z.number(),
  role: z.number(),
  teamName: z.string(),
  uid: z.string().min(1),
});

const namespaceListDataSchema = z.object({
  namespaces: z.array(namespaceDtoSchema),
});

const switchDataSchema = z.object({
  appToken: z.string().min(1),
  token: z.string().min(1),
});

export type SwitchData = z.infer<typeof switchDataSchema>;

const authInfoDataSchema = z.object({
  info: z.object({
    avatarUri: z.string().nullish(),
    id: z.string().nullish(),
    name: z.string().nullish(),
    nickname: z.string().nullish(),
    uid: z.string().nullish(),
  }),
});

export type AuthInfoData = z.infer<typeof authInfoDataSchema>;

function workspaceFromDto(
  dto: z.infer<typeof namespaceDtoSchema>
): SessionWorkspace | null {
  const role = DESKTOP_ROLES[dto.role];
  if (role == null) {
    return null;
  }
  return {
    createdAt: String(dto.createTime),
    id: dto.id,
    isPersonal: dto.nstype === DESKTOP_NSTYPE_PRIVATE,
    name: dto.teamName,
    role,
    uid: dto.uid,
  };
}

/**
 * `namespace/create`'s answer: the new Team Workspace as Desktop describes
 * it. Only the identifiers and the name matter to Workspace Creation — the
 * subscription payment addresses it by `id`, the Switcher by `uid`.
 */
export interface DesktopCreatedWorkspace {
  id: string;
  name: string;
  uid: string;
}

export const desktopCreatedWorkspaceSchema = z
  .object({ namespace: namespaceDtoSchema })
  .transform(
    (data): DesktopCreatedWorkspace => ({
      id: data.namespace.id,
      name: data.namespace.teamName,
      uid: data.namespace.uid,
    })
  );

/** The user's Workspaces in Brain's shape, in Desktop's order (Personal first). */
export const desktopWorkspaceListSchema = namespaceListDataSchema.transform(
  (data, ctx): SessionWorkspace[] => {
    const workspaces: SessionWorkspace[] = [];
    for (const dto of data.namespaces) {
      const workspace = workspaceFromDto(dto);
      if (workspace == null) {
        ctx.addIssue({ code: "custom", message: "unknown workspace role" });
        return z.NEVER;
      }
      workspaces.push(workspace);
    }
    return workspaces;
  }
);

/** `TeamUserDto`: one IN_WORKSPACE member as Desktop's `details` lists it. */
const teamUserDtoSchema = z.object({
  alias: z.string().nullish(),
  avatarUrl: z.string().nullish(),
  crUid: z.string().min(1),
  createdTime: z.union([z.string(), z.number()]).nullish(),
  joinTime: z.union([z.string(), z.number()]).nullish(),
  k8s_username: z.string(),
  nickname: z.string().nullish(),
  role: z.number(),
  uid: z.string().nullish(),
});

/** A Desktop timestamp — ISO text or an epoch number — as ISO text; "" when absent. */
function isoTimestamp(value: string | number | null | undefined): string {
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function memberFromDto(
  dto: z.infer<typeof teamUserDtoSchema>
): WorkspaceMember | null {
  const role = DESKTOP_ROLES[dto.role];
  if (role == null) {
    return null;
  }
  // Desktop leaves `joinTime` optional; the User CR's creation time is the
  // closest fact when it is missing.
  const joined = dto.joinTime ?? dto.createdTime;
  return {
    alias: dto.alias == null || dto.alias === "" ? null : dto.alias,
    avatarUrl: dto.avatarUrl ?? "",
    crName: dto.k8s_username,
    crUid: dto.crUid,
    joinedAt: isoTimestamp(joined),
    nickname: dto.nickname ?? "",
    role,
    userUid: dto.uid ?? "",
  };
}

export interface DesktopWorkspaceDetails {
  members: WorkspaceMember[];
  workspace: SessionWorkspace;
}

/**
 * Desktop's `details` answer in Brain's shape. Desktop judges `nstype` here
 * by `id === 'ns-' + userCrName` rather than by the membership row's
 * `isPrivate` as `list` does; the Workspace Area keeps the list's verdict
 * and reads only the members from this answer.
 */
export const desktopWorkspaceDetailsSchema = z
  .object({
    namespace: namespaceDtoSchema,
    users: z.array(teamUserDtoSchema),
  })
  .transform((data, ctx): DesktopWorkspaceDetails => {
    const workspace = workspaceFromDto(data.namespace);
    if (workspace == null) {
      ctx.addIssue({ code: "custom", message: "unknown workspace role" });
      return z.NEVER;
    }
    const members: WorkspaceMember[] = [];
    for (const dto of data.users) {
      const member = memberFromDto(dto);
      if (member == null) {
        ctx.addIssue({ code: "custom", message: "unknown member role" });
        return z.NEVER;
      }
      members.push(member);
    }
    return { members, workspace };
  });

export interface DesktopAuthApi {
  authInfo(regionalToken: string): Promise<DesktopCallResult<AuthInfoData>>;
  /** Transfers ownership to `targetCrUid`; the caller becomes a Developer. */
  namespaceAbdicate(
    regionalToken: string,
    workspaceUid: string,
    targetCrUid: string
  ): Promise<DesktopCallResult<null>>;
  /**
   * Creates a Team Workspace for a subscription (spec §G.3). Desktop's
   * `create` verifies the app token too, so the call carries it raw — no
   * encoding, no scheme — and needs no regional token.
   */
  namespaceCreate(
    appToken: string,
    name: string
  ): Promise<DesktopCallResult<DesktopCreatedWorkspace>>;
  namespaceDelete(
    regionalToken: string,
    workspaceUid: string
  ): Promise<DesktopCallResult<null>>;
  namespaceDetails(
    regionalToken: string,
    workspaceUid: string
  ): Promise<DesktopCallResult<DesktopWorkspaceDetails>>;
  /** A Workspace Invite Link code for `role` (never Owner; the schema forbids it). */
  namespaceInviteCode(
    regionalToken: string,
    workspaceUid: string,
    role: WorkspaceRole
  ): Promise<DesktopCallResult<InviteCodeData>>;
  namespaceList(
    regionalToken: string
  ): Promise<DesktopCallResult<SessionWorkspace[]>>;
  namespaceModifyRole(
    regionalToken: string,
    workspaceUid: string,
    targetCrUid: string,
    role: WorkspaceRole
  ): Promise<DesktopCallResult<null>>;
  /** Removes a member; the caller's own crUid means leaving. */
  namespaceRemoveUser(
    regionalToken: string,
    workspaceUid: string,
    targetCrUid: string
  ): Promise<DesktopCallResult<null>>;
  namespaceRename(
    regionalToken: string,
    workspaceUid: string,
    name: string
  ): Promise<DesktopCallResult<null>>;
  /** Sets a member's alias in this Workspace; null clears it. */
  namespaceSetAlias(
    regionalToken: string,
    workspaceUid: string,
    targetCrUid: string,
    alias: string | null
  ): Promise<DesktopCallResult<null>>;
  namespaceSwitch(
    regionalToken: string,
    workspaceUid: string
  ): Promise<DesktopCallResult<SwitchData>>;
  regionToken(globalToken: string): Promise<DesktopCallResult<RegionTokenData>>;
}

export function createDesktopAuthApi(client: DesktopClient): DesktopAuthApi {
  const post = <T>(
    regionalToken: string,
    path: string,
    body: unknown,
    dataSchema: z.ZodType<T>
  ) =>
    client.call({
      authorization: encodedTokenAuthorization(regionalToken),
      body,
      dataSchema,
      method: "POST",
      path,
    });
  return {
    authInfo: (regionalToken) =>
      client.call({
        authorization: encodedTokenAuthorization(regionalToken),
        dataSchema: authInfoDataSchema,
        method: "GET",
        path: DESKTOP_AUTH_PATHS.info,
      }),
    namespaceAbdicate: (regionalToken, workspaceUid, targetCrUid) =>
      post(
        regionalToken,
        DESKTOP_AUTH_PATHS.namespaceAbdicate,
        { ns_uid: workspaceUid, targetUserCrUid: targetCrUid },
        voidDataSchema
      ),
    namespaceCreate: (appToken, name) =>
      client.call({
        authorization: appToken,
        body: { teamName: name, userType: "subscription" },
        dataSchema: desktopCreatedWorkspaceSchema,
        method: "POST",
        path: DESKTOP_AUTH_PATHS.namespaceCreate,
      }),
    namespaceDelete: (regionalToken, workspaceUid) =>
      post(
        regionalToken,
        DESKTOP_AUTH_PATHS.namespaceDelete,
        { ns_uid: workspaceUid },
        voidDataSchema
      ),
    namespaceDetails: (regionalToken, workspaceUid) =>
      client.call({
        authorization: encodedTokenAuthorization(regionalToken),
        body: { ns_uid: workspaceUid },
        dataSchema: desktopWorkspaceDetailsSchema,
        method: "POST",
        path: DESKTOP_AUTH_PATHS.namespaceDetails,
      }),
    namespaceInviteCode: (regionalToken, workspaceUid, role) =>
      post(
        regionalToken,
        DESKTOP_AUTH_PATHS.namespaceInviteCode,
        { ns_uid: workspaceUid, role: DESKTOP_ROLE_CODES[role] },
        inviteCodeDataSchema
      ),
    namespaceList: (regionalToken) =>
      client.call({
        authorization: encodedTokenAuthorization(regionalToken),
        dataSchema: desktopWorkspaceListSchema,
        method: "GET",
        path: DESKTOP_AUTH_PATHS.namespaceList,
      }),
    namespaceModifyRole: (regionalToken, workspaceUid, targetCrUid, role) =>
      post(
        regionalToken,
        DESKTOP_AUTH_PATHS.namespaceModifyRole,
        {
          ns_uid: workspaceUid,
          tRole: DESKTOP_ROLE_CODES[role],
          targetUserCrUid: targetCrUid,
        },
        voidDataSchema
      ),
    namespaceRemoveUser: (regionalToken, workspaceUid, targetCrUid) =>
      post(
        regionalToken,
        DESKTOP_AUTH_PATHS.namespaceRemoveUser,
        { ns_uid: workspaceUid, targetUserCrUid: targetCrUid },
        voidDataSchema
      ),
    namespaceRename: (regionalToken, workspaceUid, name) =>
      post(
        regionalToken,
        DESKTOP_AUTH_PATHS.namespaceRename,
        { ns_uid: workspaceUid, teamName: name },
        voidDataSchema
      ),
    namespaceSetAlias: (regionalToken, workspaceUid, targetCrUid, alias) =>
      post(
        regionalToken,
        DESKTOP_AUTH_PATHS.namespaceSetAlias,
        { alias, ns_uid: workspaceUid, targetUserCrUid: targetCrUid },
        voidDataSchema
      ),
    namespaceSwitch: (regionalToken, workspaceUid) =>
      client.call({
        authorization: encodedTokenAuthorization(regionalToken),
        body: { ns_uid: workspaceUid },
        dataSchema: switchDataSchema,
        method: "POST",
        path: DESKTOP_AUTH_PATHS.namespaceSwitch,
      }),
    regionToken: (globalToken) =>
      client.call({
        authorization: encodedTokenAuthorization(globalToken),
        dataSchema: regionTokenDataSchema,
        method: "POST",
        path: DESKTOP_AUTH_PATHS.regionToken,
      }),
  };
}
