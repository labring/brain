import {
  completeAuthorization,
  handleProviderError,
  startAuthorize,
} from "@/lib/github-app/service";
import {
  parseInstallNamespaceParam,
  parseInstallReturnPathParam,
} from "@/lib/github-app/types";

export const runtime = "nodejs";

/**
 * Single-handler GitHub App installation round-trip:
 *   - `?error=…`  → provider denied/failed; clean up cookies and bounce home.
 *   - no `?installation_id=` → first hop; persist state and redirect to GitHub App install.
 *   - with `?installation_id=` → second hop; verify state, store installation, redirect.
 */
export function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get("error")) {
    return handleProviderError(request);
  }
  const installationId = searchParams.get("installation_id");
  if (!installationId) {
    return startAuthorize(request, {
      namespace: parseInstallNamespaceParam(searchParams.get("namespace")),
      returnPath: parseInstallReturnPathParam(searchParams.get("next")),
    });
  }
  return completeAuthorization(request, {
    installationId,
    setupAction: searchParams.get("setup_action"),
    state: searchParams.get("state"),
  });
}
