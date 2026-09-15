/**
 * The structured error codes the Workspace-management routes answer with
 * (spec §B.1): Brain translates Desktop's "HTTP 200 + `body.code`" envelope
 * into real HTTP statuses and its own codes, never forwarding Desktop's
 * hard-coded message text. Client-safe: the page keys its reaction on
 * these.
 */
export const WORKSPACE_ERROR_CODES = {
  conflict: "workspace_conflict",
  desktopError: "desktop_error",
  desktopTimeout: "desktop_timeout",
  desktopUnavailable: "desktop_unavailable",
  forbidden: "workspace_forbidden",
  invalidRequest: "invalid_workspace_request",
  notFound: "workspace_not_found",
  /** The regional token was refused: the session fetch's 401 two-step runs. */
  sessionExpired: "session_expired",
  /** `X-Sealos-Region-Token` is missing on the request. */
  regionTokenRequired: "region_token_required",
} as const;
