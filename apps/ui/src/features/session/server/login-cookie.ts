import "server-only";

/**
 * Desktop writes its global token into the shared login cookie on the parent
 * domain (`.<registrable domain>`, not HttpOnly), so the browser attaches it
 * to Brain's own same-origin requests (ADR-0083). Brain forwards its value
 * to exactly one place — Desktop's `regionToken` — and never logs it.
 */
export const SEALOS_AUTH_COOKIE = "sealos_auth_token";

function cookieValue(header: string | null, name: string): string {
  for (const pair of (header ?? "").split(";")) {
    const separator = pair.indexOf("=");
    if (separator === -1) {
      continue;
    }
    if (pair.slice(0, separator).trim() === name) {
      const raw = pair.slice(separator + 1).trim();
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }
  }
  return "";
}

/**
 * The global token for this request: the shared login cookie, or, when the
 * cookie is absent in a non-production build, `DEV_GLOBAL_TOKEN` — the
 * developer's stand-in for a Desktop shell (spec §I.1). A production build
 * never reads the variable, so a stray value cannot become a session.
 */
export function globalTokenFromRequest(
  request: Request,
  env: Record<string, string | undefined> = process.env
): string {
  const fromCookie = cookieValue(
    request.headers.get("cookie"),
    SEALOS_AUTH_COOKIE
  ).trim();
  if (fromCookie !== "") {
    return fromCookie;
  }
  if (env.NODE_ENV === "production") {
    return "";
  }
  return env.DEV_GLOBAL_TOKEN?.trim() ?? "";
}
