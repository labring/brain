import {
  completeAuthorization,
  handleProviderError,
  startAuthorize,
} from "@/lib/github-oauth/service";
import {
  parseOAuthNamespaceParam,
  parseOAuthReturnPathParam,
} from "@/lib/github-oauth/types";

export const runtime = "nodejs";

/**
 * Single-handler OAuth round-trip:
 *   - `?error=…`  → provider denied/failed; clean up cookies and bounce home.
 *   - no `?code=` → first hop; persist PKCE + state and redirect to GitHub authorize.
 *   - with `?code=` → second hop; verify state, exchange code, apply GHCR secret, redirect.
 */
export function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get("error")) {
    return handleProviderError(request);
  }
  const code = searchParams.get("code");
  if (!code) {
    return startAuthorize(request, {
      namespace: parseOAuthNamespaceParam(searchParams.get("namespace")),
      returnPath: parseOAuthReturnPathParam(searchParams.get("next")),
    });
  }
  return completeAuthorization(request, {
    code,
    state: searchParams.get("state"),
  });
}
