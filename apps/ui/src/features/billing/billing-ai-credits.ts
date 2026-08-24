import {
  formatAiCredits as formatAiCreditsCore,
  MICRO_UNITS_PER_AI_CREDIT as MICRO_UNITS_PER_AI_CREDIT_CORE,
  parseAiQuotaPayload,
} from "./ai-quota-core";
import {
  type BillingCredentials,
  type BillingFetch,
  createBillingJsonRequester,
} from "./billing-data-client";

export const formatAiCredits = formatAiCreditsCore;
export const MICRO_UNITS_PER_AI_CREDIT = MICRO_UNITS_PER_AI_CREDIT_CORE;

export interface AiCredits {
  totalMicroUnits: number;
  usedMicroUnits: number;
}

export function aiCreditsPercentUsed(
  usedMicroUnits: number,
  totalMicroUnits: number
): number {
  if (totalMicroUnits <= 0) {
    return 0;
  }
  const percent = (usedMicroUnits / totalMicroUnits) * 100;
  if (!Number.isFinite(percent)) {
    return 0;
  }
  return Math.min(100, Math.max(0, percent));
}

export async function loadAiCredits(
  credentials: BillingCredentials & { workspace: string },
  fetch: BillingFetch = globalThis.fetch
): Promise<AiCredits> {
  const requestBillingJson = createBillingJsonRequester({
    credentials,
    fallbackErrorMessage: "Could not load AI Credits.",
    fetch,
  });
  const payload = await requestBillingJson("/api/billing/workspace-quota", {
    workspace: credentials.workspace,
  });
  const parsed = parseAiQuotaPayload(payload);
  return {
    totalMicroUnits: parsed.totalMicroUnits,
    usedMicroUnits: parsed.usedMicroUnits,
  };
}
