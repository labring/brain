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
  namespaceDetails: "/api/auth/namespace/details",
  namespaceList: "/api/auth/namespace/list",
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
    joinedAt: joined == null ? "" : String(joined),
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
  namespaceDetails(
    regionalToken: string,
    workspaceUid: string
  ): Promise<DesktopCallResult<DesktopWorkspaceDetails>>;
  namespaceList(
    regionalToken: string
  ): Promise<DesktopCallResult<SessionWorkspace[]>>;
  namespaceSwitch(
    regionalToken: string,
    workspaceUid: string
  ): Promise<DesktopCallResult<SwitchData>>;
  regionToken(globalToken: string): Promise<DesktopCallResult<RegionTokenData>>;
}

export function createDesktopAuthApi(client: DesktopClient): DesktopAuthApi {
  return {
    authInfo: (regionalToken) =>
      client.call({
        authorization: encodedTokenAuthorization(regionalToken),
        dataSchema: authInfoDataSchema,
        method: "GET",
        path: DESKTOP_AUTH_PATHS.info,
      }),
    namespaceDetails: (regionalToken, workspaceUid) =>
      client.call({
        authorization: encodedTokenAuthorization(regionalToken),
        body: { ns_uid: workspaceUid },
        dataSchema: desktopWorkspaceDetailsSchema,
        method: "POST",
        path: DESKTOP_AUTH_PATHS.namespaceDetails,
      }),
    namespaceList: (regionalToken) =>
      client.call({
        authorization: encodedTokenAuthorization(regionalToken),
        dataSchema: desktopWorkspaceListSchema,
        method: "GET",
        path: DESKTOP_AUTH_PATHS.namespaceList,
      }),
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
