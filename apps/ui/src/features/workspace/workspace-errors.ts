import { SESSION_ERROR_CODES } from "@/features/session/session-schema";

/**
 * The structured error codes the Workspace-management routes answer with
 * (spec §B.1): Brain translates Desktop's "HTTP 200 + `body.code`" envelope
 * into real HTTP statuses and its own codes, never forwarding Desktop's
 * hard-coded message text. Client-safe: the page keys its reaction on
 * these. The codes shared with `POST /api/session` are the session's own
 * constants, so the 401 two-step keys on one `session_expired`.
 */
export const WORKSPACE_ERROR_CODES = {
  conflict: "workspace_conflict",
  desktopError: "desktop_error",
  desktopTimeout: SESSION_ERROR_CODES.desktopTimeout,
  desktopUnavailable: SESSION_ERROR_CODES.desktopUnavailable,
  forbidden: "workspace_forbidden",
  invalidRequest: "invalid_workspace_request",
  notFound: "workspace_not_found",
  /** `X-Sealos-Region-Token` is missing on the request. */
  regionTokenRequired: "region_token_required",
  /** The regional token was refused: the session fetch's 401 two-step runs. */
  sessionExpired: SESSION_ERROR_CODES.sessionExpired,
} as const;
