import {
  judgeWorkspaceBillingStanding,
  type WorkspaceBillingStanding,
} from "./billing-standing-core";

/**
 * Reads the four account-service bodies a billing standing is judged from.
 * The fetcher is injected: production signs an internal JWT per call
 * (ADR-0060), dev/demo answers from the billing Dev Mock's fixtures, tests
 * hand in either. A read that fails, times out, or is not configured
 * answers null and leaves its fact unknown — a billing judgment must never
 * stall or fail the user's request (the free-trial judgment's rule).
 */

export const ACCOUNT_PATHNAME = "/account/v1alpha1/account";
export const CREDITS_INFO_PATHNAME = "/payment/v1alpha1/credits/info";
export const SUBSCRIPTION_INFO_PATHNAME =
  "/account/v1alpha1/workspace-subscription/info";
export const RESOURCE_QUOTA_PATHNAME =
  "/account/v1alpha1/workspace/get-resource-quota";

/** POSTs one account-service pathname; resolves null on any failure. */
export type BillingPayloadFetch = (
  pathname: string,
  body: Record<string, unknown>
) => Promise<unknown>;

export interface ReadWorkspaceBillingStandingInput {
  regionDomain: string;
  workspace: string;
}

async function quietly(read: Promise<unknown>): Promise<unknown> {
  try {
    return await read;
  } catch {
    return null;
  }
}

export async function readWorkspaceBillingStanding(
  input: ReadWorkspaceBillingStandingInput,
  fetchPayload: BillingPayloadFetch
): Promise<WorkspaceBillingStanding> {
  const workspace = input.workspace.trim();
  const [account, credits, quota, subscription] = await Promise.all([
    quietly(fetchPayload(ACCOUNT_PATHNAME, {})),
    quietly(fetchPayload(CREDITS_INFO_PATHNAME, {})),
    quietly(fetchPayload(RESOURCE_QUOTA_PATHNAME, { workspace })),
    quietly(
      fetchPayload(SUBSCRIPTION_INFO_PATHNAME, {
        regionDomain: input.regionDomain,
        workspace,
      })
    ),
  ]);
  return judgeWorkspaceBillingStanding({
    account,
    credits,
    quota,
    subscription,
  });
}
