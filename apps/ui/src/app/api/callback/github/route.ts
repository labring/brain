import {
  completeAuthorization,
  handleProviderError,
  startAuthorize,
} from "@/lib/github-app/service";

export const runtime = "nodejs";

/**
 * Single-handler GitHub App installation round-trip:
 *   - `?error=…`  → provider denied/failed; bounce home.
 *   - no `?installation_id=` → reject direct entry; install starts from Desktop SDK session.
 *   - with `?installation_id=` → second hop; verify state, store installation, redirect.
 */
export function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get("error")) {
    return handleProviderError(request);
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
