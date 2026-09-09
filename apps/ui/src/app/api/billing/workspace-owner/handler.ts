import {
  type AuthorizeWorkspaceActor,
  authorizeBillingActor,
} from "@/features/billing/server/authorized-proxy";
import { BILLING_JUDGMENT_TIMEOUT_MS } from "@/features/billing/server/judgment-budget";
import type { readWorkspaceOwnerStanding } from "@/features/billing/server/workspace-owner-reader";

/**
 * The Workspace Owner standing for the verified Workspace Actor (ADR-0082):
 * the namespace's platform marks read with the request kubeconfig, judged
 * against the app-token-proven crName on the server — the client renders
 * the verdict and never derives it, so the banner and the walls share one
 * Owner judgment. An unreadable namespace answers unknown, not an error,
 * and the read runs under the same budget as every other billing judgment
 * so a stuck namespace get cannot hang the banner and the Plan view.
 */
export function createWorkspaceOwnerHandler(dependencies: {
  authorizeWorkspaceActor: AuthorizeWorkspaceActor;
  readWorkspaceOwnerStanding: typeof readWorkspaceOwnerStanding;
}) {
  return async function handler(request: Request): Promise<Response> {
    const actor = await authorizeBillingActor(
      request,
      dependencies.authorizeWorkspaceActor
    );
    if (!actor.ok) {
      return actor.response;
    }
    const standing = await dependencies.readWorkspaceOwnerStanding({
      crName: actor.crName,
      encodedKubeconfig: actor.encodedKubeconfig,
      namespace: actor.namespace,
      signal: AbortSignal.timeout(BILLING_JUDGMENT_TIMEOUT_MS),
    });
    return Response.json(standing, {
      headers: { "cache-control": "no-store" },
    });
  };
}
