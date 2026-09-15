import { z } from "zod";

/**
 * The Brain Session contract (ADR-0083, spec §A.2): what `POST /api/session`
 * answers and the page holds in memory. This is Brain's own shape — the
 * server translates Desktop's DTOs into it and the client validates it — so
 * the page never depends on a Desktop response shape. The response body is
 * the one place the three credentials travel to the page; nothing else in
 * Brain may log or echo them.
 */

export const WORKSPACE_ROLES = ["Owner", "Manager", "Developer"] as const;

export const workspaceRoleSchema = z.enum(WORKSPACE_ROLES);

export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>;

export const sessionWorkspaceSchema = z.object({
  createdAt: z.string(),
  /** The Kubernetes namespace name, `ns-…`; what the SDK calls `nsid`. */
  id: z.string().min(1),
  isPersonal: z.boolean(),
  name: z.string(),
  role: workspaceRoleSchema,
  /** The stable Workspace uid (uuid); what Desktop's `switch` takes. */
  uid: z.string().min(1),
});

export type SessionWorkspace = z.infer<typeof sessionWorkspaceSchema>;

export const sessionUserSchema = z.object({
  avatar: z.string(),
  /** The regional User CR name; the "You" comparison key in member lists. */
  crName: z.string(),
  name: z.string(),
  /** Legacy platform user id (account-service's `userId`). */
  userId: z.string(),
  /** The global user UID (ADR-0059). */
  userUid: z.string(),
});

export type SessionUser = z.infer<typeof sessionUserSchema>;

export const SESSION_FALLBACKS = ["not_member"] as const;

export const brainSessionSchema = z.object({
  appToken: z.string().min(1),
  /**
   * Set when the requested `nsid` was not in the user's Workspace list and
   * the session landed in the Personal Workspace instead (spec §A.3).
   */
  fallback: z.enum(SESSION_FALLBACKS).optional(),
  /** The kubeconfig with its context namespace rewritten to `namespace`. */
  kubeconfig: z.string().min(1),
  namespace: z.string().min(1),
  regionalToken: z.string().min(1),
  user: sessionUserSchema,
  /** The Workspace the session is established in — Desktop's current one. */
  workspace: sessionWorkspaceSchema,
  /** Every Workspace the user belongs to in this region, Personal first. */
  workspaces: z.array(sessionWorkspaceSchema),
});

export type BrainSession = z.infer<typeof brainSessionSchema>;

export const sessionRequestSchema = z.object({
  /** Desktop's current namespace id (`ns-…`) as read from the SDK; omitted outside the iframe. */
  nsid: z.string().trim().optional(),
});

export type SessionRequest = z.infer<typeof sessionRequestSchema>;

/**
 * The structured error codes `POST /api/session` answers with (spec §A.3);
 * the client keys its reaction on these, never on Desktop's message text.
 */
export const SESSION_ERROR_CODES = {
  desktopTimeout: "desktop_timeout",
  desktopUnavailable: "desktop_unavailable",
  invalidRequest: "invalid_session_request",
  sessionExpired: "session_expired",
  workspaceNotInited: "workspace_not_inited",
} as const;

export type SessionErrorCode =
  (typeof SESSION_ERROR_CODES)[keyof typeof SESSION_ERROR_CODES];

export const sessionErrorSchema = z.object({
  error: z.string(),
});
