import {
  completeAuthorization,
  completeOAuthAuthorization,
  handleProviderError,
  startAuthorize,
} from "@/lib/github-app/service";

export const runtime = "nodejs";

/**
 * GitHub callback:
 *   - `?error=…`  → provider denied/failed; bounce home.
 *   - `?code=…`   → OAuth App authorization; store an encrypted user token.
 *   - no `?installation_id=` → reject direct entry; install/configure starts from Desktop SDK session.
 *   - with `?installation_id=` → verify state, store installation, redirect.
 */
export function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get("error")) {
    return handleProviderError(request);
  }
  if (searchParams.get("code")) {
    return completeOAuthAuthorization(request, {
      code: searchParams.get("code"),
      state: searchParams.get("state"),
    });
  }
  const installationId = searchParams.get("installation_id");
  if (!installationId) {
    return startAuthorize();
  }
  return completeAuthorization(request, {
    installationId,
    setupAction: searchParams.get("setup_action"),
    state: searchParams.get("state"),
  });
}
