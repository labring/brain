import { createGithubOAuthCallbackHandler } from "@/features/deploy/github/connection-http-handlers";
import { isGithubAuthorizationSessionValid } from "@/features/deploy/github/install-session-service";
import {
  cancelOAuthAuthorization,
  completeAuthorization,
  completeOAuthAuthorization,
  startAuthorize,
} from "@/features/deploy/github/service";

export const runtime = "nodejs";

const completeOAuthCallback = createGithubOAuthCallbackHandler({
  cancelAuthorization: cancelOAuthAuthorization,
  completeAuthorization: completeOAuthAuthorization,
  validateState: isGithubAuthorizationSessionValid,
});

/**
 * GitHub callback:
 *   - `?error=…`  → provider denied/failed; bounce home.
 *   - `?code=…`   → OAuth App authorization; store an encrypted user token.
 *   - no `?installation_id=` → reject direct entry; install/configure starts from Desktop SDK session.
 *   - with `?installation_id=` → verify state, store installation, redirect.
 */
export function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.has("error") || searchParams.has("code")) {
    return completeOAuthCallback(request);
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
