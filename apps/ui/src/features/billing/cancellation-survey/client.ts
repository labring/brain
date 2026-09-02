import {
  type BillingCredentials,
  type BillingFetch,
  createBillingJsonRequester,
} from "@/features/billing/billing-data-client";

import type { CancellationSurveyAnswers } from "./reasons";

export const CANCELLATION_SURVEY_API_PATH =
  "/api/billing/subscription/cancellation-survey";

/**
 * Submits one Cancellation Survey response to Brain (ADR-0072). Callers run
 * it only after account-service confirmed the cancel and treat it as
 * best-effort: a rejection is swallowed, never shown, so the person is not
 * told a cancellation failed because a survey did.
 */
export async function submitCancellationSurvey(
  input: BillingCredentials &
    CancellationSurveyAnswers & {
      currentPeriodEndAt: string | null;
      planName: string;
      regionDomain: string;
      workspace: string;
    },
  dependencies: { fetch?: BillingFetch } = {}
): Promise<void> {
  const requestBillingJson = createBillingJsonRequester({
    credentials: { appToken: input.appToken, kubeconfig: input.kubeconfig },
    fallbackErrorMessage: "Could not record the cancellation survey.",
    fetch: dependencies.fetch ?? globalThis.fetch,
  });
  await requestBillingJson(CANCELLATION_SURVEY_API_PATH, {
    currentPeriodEndAt: input.currentPeriodEndAt,
    feedback: input.feedback,
    planName: input.planName,
    reasons: input.reasons,
    regionDomain: input.regionDomain,
    workspace: input.workspace,
  });
}
