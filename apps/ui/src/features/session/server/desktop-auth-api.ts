import "server-only";

import { z } from "zod";

import type { SessionWorkspace, WorkspaceRole } from "../session-schema";
import {
  type DesktopCallResult,
  type DesktopClient,
  encodedTokenAuthorization,
} from "./desktop-client";

/**
 * The four Desktop `/api/auth/*` calls the Brain Session needs (spec §A.1),
 * typed against the Desktop DTOs they answer with. Each takes the token in
 * the form Desktop's verifier expects — the global token for `regionToken`,
 * the regional token everywhere else — and returns the raw DTO; the session
 * service turns DTOs into Brain's own shapes.
 */

export const DESKTOP_AUTH_PATHS = {
  info: "/api/auth/info",
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

export interface DesktopAuthApi {
  authInfo(regionalToken: string): Promise<DesktopCallResult<AuthInfoData>>;
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
