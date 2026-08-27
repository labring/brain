import { z } from "zod";

import {
  type BillingFetch,
  createBillingJsonRequester,
} from "./billing-data-client";

// account-service's credits/info reports aggregate totals over the active
// Credits rows (GetAvailableCredits filters to unexpired ones upstream)
// alongside two labeled pairs: the KYC/free-plan row — the new-user gift —
// and the current plan's own grant. On a Free trial upstream copies the KYC
// pair from the current-plan pair, so the two agree there by construction.
// No pair carries a per-row expire_at, so the gift's expiry date is not
// readable through any proxied endpoint today (AIM-315's gap list).
const accountCreditsResponseSchema = z.object({
  credits: z.object({
    credits: z.number().default(0),
    deductionCredits: z.number().default(0),
    kycDeductionCreditsBalance: z.number().default(0),
    kycDeductionCreditsDeductionBalance: z.number().default(0),
  }),
});

export interface AccountCredits {
  /**
   * Remaining new-user gift (the KYC/free-plan row): what the Gift chip may
   * label. Never larger than usableMicroUnits.
   */
  giftMicroUnits: number;
  /**
   * Remaining usable credit across every active row — gift, plan grant, and
   * anything else — the credits term of the platform's debt formula. Feeds
   * the available Account Balance figure.
   */
  usableMicroUnits: number;
}

export async function loadAccountCredits(
  credentials: {
    appToken: string;
    kubeconfig: string;
  },
  fetch: BillingFetch = globalThis.fetch
): Promise<AccountCredits> {
  const requestBillingJson = createBillingJsonRequester({
    credentials,
    fallbackErrorMessage: "Could not load gift credits.",
    fetch,
  });
  const payload = await requestBillingJson("/api/billing/credits");
  const parsed = accountCreditsResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error("Gift credits response is invalid.");
  }
  const { credits } = parsed.data;
  const usableMicroUnits = Math.max(
    0,
    credits.credits - credits.deductionCredits
  );
  return {
    giftMicroUnits: Math.min(
      usableMicroUnits,
      Math.max(
        0,
        credits.kycDeductionCreditsBalance -
          credits.kycDeductionCreditsDeductionBalance
      )
    ),
    usableMicroUnits,
  };
}
