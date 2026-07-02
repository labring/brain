/**
 * Client + server safe public surface of the GitHub App install module.
 */

/** Must match the GitHub App's registered setup callback URL. */
export const GITHUB_APP_INSTALL_CALLBACK_PATH = "/api/callback/github" as const;

/** Same-origin page opened after the GitHub App callback finishes in a popup. */
export const GITHUB_APP_INSTALL_COMPLETE_PATH =
  "/github/install-complete" as const;

/** Browser event sent from the GitHub App popup back to the opener. */
export const GITHUB_APP_INSTALL_COMPLETE_MESSAGE =
  "github-app-install-complete" as const;

/** Max length for path + search stored in pending install session / `next` query. */
export const MAX_INSTALL_RETURN_PATH_LEN = 2048;

/** Conservative namespace format accepted from the browser during install. */
const INSTALL_NAMESPACE_RE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

/** Max length for Kubernetes namespace names. */
const MAX_INSTALL_NAMESPACE_LEN = 63;

/**
 * Normalize and validate a same-origin relative return target (pathname + optional search).
 * Rejects absolute URLs and protocol-relative paths to avoid open redirects.
 */
export function parseInstallReturnPathParam(raw: string | null): string | null {
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
    decoded.length > MAX_INSTALL_RETURN_PATH_LEN ||
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
 * Normalize the current UI namespace for the GitHub App install round-trip.
 * Rejects invalid values instead of persisting arbitrary client input.
 */
export function parseInstallNamespaceParam(raw: string | null): string | null {
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
    namespace.length > MAX_INSTALL_NAMESPACE_LEN ||
    !INSTALL_NAMESPACE_RE.test(namespace)
  ) {
    return null;
  }
  return namespace;
}
