import { z } from "zod";

import {
  sessionWorkspaceSchema,
  workspaceRoleSchema,
} from "@/features/session/session-schema";

/**
 * `POST /api/workspace/details { uid }` (spec §B.2): the Managed Workspace
 * and its members in Brain's own shape. Client-safe: the Workspace Area
 * validates the response with it and the server answers in it.
 */

export const workspaceDetailsRequestSchema = z.object({
  /** The Workspace uid (uuid); what Desktop's `details` takes as `ns_uid`. */
  uid: z.string().trim().min(1),
});

export type WorkspaceDetailsRequest = z.infer<
  typeof workspaceDetailsRequestSchema
>;

export const workspaceMemberSchema = z.object({
  /** The alias set for this member in this Workspace; null when unset. */
  alias: z.string().nullable(),
  avatarUrl: z.string(),
  /** The regional User CR name; `=== session.user.crName` marks "You". */
  crName: z.string(),
  /** The membership record's User CR uid; what the member routes target. */
  crUid: z.string().min(1),
  joinedAt: z.string(),
  nickname: z.string(),
  role: workspaceRoleSchema,
  /** The global user UID. */
  userUid: z.string(),
});

export type WorkspaceMember = z.infer<typeof workspaceMemberSchema>;

export const workspaceDetailsResponseSchema = z.object({
  members: z.array(workspaceMemberSchema),
  workspace: sessionWorkspaceSchema,
});

export type WorkspaceDetailsResponse = z.infer<
  typeof workspaceDetailsResponseSchema
>;
