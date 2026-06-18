/**
 * Client + server safe public surface of the GitHub OAuth module.
 * Cookie names and node-only helpers live in sibling files.
 */

/** Must match `packages/api/src/api.actions.ts` (YAML secret name). */
export const GHCR_CRED_SECRET_NAME = "ghcr-cred" as const;

/** StringData/data key holding the PAT — must match `packages/api/src/api.actions.ts`. */
export const GHCR_CRED_TOKEN_KEY = "githubToken" as const;

/** Must match the GitHub OAuth app's registered callback URL. */
export const GITHUB_OAUTH_CALLBACK_PATH = "/api/callback/github" as const;

/** Same-origin page opened after the OAuth callback finishes in a popup. */
export const GITHUB_OAUTH_COMPLETE_PATH = "/github/oauth-complete" as const;

/** Browser event sent from the OAuth popup back to the opener. */
export const GITHUB_OAUTH_COMPLETE_MESSAGE = "github-oauth-complete" as const;

/** OAuth scopes requested when initiating the authorize flow. */
export const GITHUB_OAUTH_SCOPES = "repo read:packages write:packages" as const;

/** Max length for path + search stored in OAuth return cookie / `next` query. */
export const MAX_OAUTH_RETURN_PATH_LEN = 2048;

/** Conservative namespace format accepted from the browser during OAuth. */
const OAUTH_NAMESPACE_RE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

/** Max length for Kubernetes namespace names. */
const MAX_OAUTH_NAMESPACE_LEN = 63;

/**
 * Normalize and validate a same-origin relative return target (pathname + optional search).
 * Rejects absolute URLs and protocol-relative paths to avoid open redirects.
 */
export function parseOAuthReturnPathParam(raw: string | null): string | null {
  if (raw == null || raw === "") {
    return null;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  decoded = decoded.trim();
  if (
    decoded.length > MAX_OAUTH_RETURN_PATH_LEN ||
    !decoded.startsWith("/") ||
    decoded.startsWith("//") ||
    decoded.includes("://") ||
    decoded.includes("\n") ||
    decoded.includes("\r")
  ) {
    return null;
  }
  return decoded;
}

/**
 * Normalize the current UI namespace for the OAuth round-trip.
 * Rejects invalid values instead of persisting arbitrary client input.
 */
export function parseOAuthNamespaceParam(raw: string | null): string | null {
  if (raw == null || raw === "") {
    return null;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const namespace = decoded.trim();
  if (
    namespace.length === 0 ||
    namespace.length > MAX_OAUTH_NAMESPACE_LEN ||
    !OAUTH_NAMESPACE_RE.test(namespace)
  ) {
    return null;
  }
  return namespace;
}
