import { z } from "zod";

/**
 * The request and response shapes of the Workspace-management write routes
 * (spec §B.2). Client-safe: the Workspace Area builds its requests from
 * these, the route handlers validate bodies with them, and the dev-mock
 * fixtures answer in them. Where Desktop leaves a hole, the schema closes
 * it — a role on a link or a role change is never Owner, an alias is
 * trimmed and capped at Desktop's 128, a Workspace name at the spec's 32.
 */

/** The roles a Workspace Invite Link or a role change may carry (spec §E.4). */
export const ASSIGNABLE_ROLE_VALUES = ["Manager", "Developer"] as const;

export const assignableRoleSchema = z.enum(ASSIGNABLE_ROLE_VALUES);

export type AssignableRole = z.infer<typeof assignableRoleSchema>;

export const WORKSPACE_NAME_MAX_LENGTH = 32;
export const WORKSPACE_ALIAS_MAX_LENGTH = 128;

const workspaceUidSchema = z.string().trim().min(1);
const memberCrUidSchema = z.string().trim().min(1);

/** A Workspace name: trimmed, required, at most 32 characters (spec, Further Notes). */
export const workspaceNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(WORKSPACE_NAME_MAX_LENGTH);

export const workspaceRenameRequestSchema = z.object({
  name: workspaceNameSchema,
  uid: workspaceUidSchema,
});

export const workspaceDeleteRequestSchema = z.object({
  uid: workspaceUidSchema,
});

export const workspaceInviteLinkRequestSchema = z.object({
  role: assignableRoleSchema,
  uid: workspaceUidSchema,
});

/** `{ code }`: the client appends it to Desktop's `/WorkspaceInvite/?code=`. */
export const workspaceInviteLinkResponseSchema = z.object({
  code: z.string().min(1),
});

export type WorkspaceInviteLinkResponse = z.infer<
  typeof workspaceInviteLinkResponseSchema
>;

export const workspaceMemberRemoveRequestSchema = z.object({
  /** The membership's User CR uid; the actor's own means "leave". */
  crUid: memberCrUidSchema,
  uid: workspaceUidSchema,
});

export const workspaceMemberRoleRequestSchema = z.object({
  crUid: memberCrUidSchema,
  role: assignableRoleSchema,
  uid: workspaceUidSchema,
});

/**
 * `alias` arrives as the user typed it; the route trims it and sends
 * Desktop null for an empty one (clear). Null is accepted on the wire too.
 */
export const workspaceMemberAliasRequestSchema = z.object({
  alias: z
    .string()
    .nullable()
    .transform((alias) => {
      const trimmed = alias?.trim() ?? "";
      return trimmed === "" ? null : trimmed;
    })
    .refine(
      (alias) => alias == null || alias.length <= WORKSPACE_ALIAS_MAX_LENGTH,
      {
        message: `alias can have at most ${WORKSPACE_ALIAS_MAX_LENGTH} characters`,
      }
    ),
  crUid: memberCrUidSchema,
  uid: workspaceUidSchema,
});

export const workspaceTransferRequestSchema = z.object({
  /** The member who becomes the Owner; the actor becomes a Developer. */
  crUid: memberCrUidSchema,
  uid: workspaceUidSchema,
});

/** What every write route but invite-link answers on success. */
export const workspaceWriteResponseSchema = z.object({ ok: z.literal(true) });

export type WorkspaceWriteResponse = z.infer<
  typeof workspaceWriteResponseSchema
>;

export const WORKSPACE_WRITE_OK: WorkspaceWriteResponse = { ok: true };
