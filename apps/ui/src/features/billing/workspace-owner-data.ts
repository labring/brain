import {
  type BillingFetch,
  createBillingJsonRequester,
} from "./billing-data-client";
import {
  parseWorkspaceOwnerStanding,
  type WorkspaceOwnerStanding,
} from "./workspace-owner";

/**
 * The Workspace Owner standing as Brain judged it on the server (ADR-0082):
 * whether the viewer is the Owner and whether the platform has marked the
 * workspace suspended for debt. The client renders the verdict and never
 * derives it, so the banner, the notice, and the walls share one judgment.
 */
export async function loadWorkspaceOwnerStanding(
  credentials: { appToken: string; kubeconfig: string },
  fetch: BillingFetch = globalThis.fetch
): Promise<WorkspaceOwnerStanding> {
  const requestBillingJson = createBillingJsonRequester({
    credentials,
    fallbackErrorMessage: "Could not load the workspace owner standing.",
    fetch,
  });
  return parseWorkspaceOwnerStanding(
    await requestBillingJson("/api/billing/workspace-owner")
  );
}
