import { z } from "zod";

import {
  type BillingFetch,
  createBillingJsonRequester,
} from "./billing-data-client";

// account-service's credits/info reports aggregate totals over the active
// Credits rows (GetAvailableCredits filters to unexpired ones upstream). It
// carries no per-row expire_at, so the gift's expiry date is not readable
// through any proxied endpoint today (AIM-315's gap list).
const accountCreditsResponseSchema = z.object({
  credits: z.object({
    credits: z.number().default(0),
    deductionCredits: z.number().default(0),
  }),
});

export interface AccountCredits {
  /** Remaining gift credit: active credits minus what deductions consumed. */
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
  return {
    usableMicroUnits: Math.max(
      0,
      parsed.data.credits.credits - parsed.data.credits.deductionCredits
    ),
  };
}
