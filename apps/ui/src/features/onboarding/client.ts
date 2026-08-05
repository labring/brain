import { personalResourceAuthHeaders } from "@/lib/personal-resource-headers";

import {
  type AnswerOnboardingStepRequest,
  type OnboardingSamplingVerdict,
  onboardingSamplingVerdictSchema,
} from "./types";

/** Credentials every Onboarding Profile fetcher sends (ADR-0061). */
export interface OnboardingFetcherCredentials {
  appToken: string;
  kubeconfig: string;
  namespace: string;
}

/**
 * `null` on any failure (HTTP error, parse failure, network) — the Gate
 * treats it as an unknown outcome and silently stands down.
 */
export async function fetchOnboardingSamplingVerdict(
  credentials: OnboardingFetcherCredentials
): Promise<OnboardingSamplingVerdict | null> {
  try {
    const res = await fetch(
      `/api/onboarding-profile/sampling?namespace=${encodeURIComponent(credentials.namespace)}`,
      { headers: personalResourceAuthHeaders(credentials) }
    );
    if (!res.ok) {
      return null;
    }
    const parsed = onboardingSamplingVerdictSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Fire-and-forget stepwise answer write: Next never waits on it, and a
 * silent failure at worst re-asks the question on the next entry (the row
 * stays short of terminal, so the person is still Unsampled).
 */
export function answerOnboardingStep(
  credentials: OnboardingFetcherCredentials,
  payload: AnswerOnboardingStepRequest
): void {
  fetch(
    `/api/onboarding-profile/step?namespace=${encodeURIComponent(credentials.namespace)}`,
    {
      body: JSON.stringify(payload),
      headers: {
        "content-type": "application/json",
        ...personalResourceAuthHeaders(credentials),
      },
      method: "POST",
    }
  ).catch(() => undefined);
}

/**
 * Fire-and-forget terminal complete: Submit & Enter Console never waits on
 * it, and the write is terminal-wins idempotent server-side, so a failure at
 * worst re-shows the dialog on the next entry.
 */
export function completeOnboardingProfile(
  credentials: OnboardingFetcherCredentials,
  openGoalText: string | null
): void {
  fetch(
    `/api/onboarding-profile/complete?namespace=${encodeURIComponent(credentials.namespace)}`,
    {
      body: JSON.stringify({ openGoalText }),
      headers: {
        "content-type": "application/json",
        ...personalResourceAuthHeaders(credentials),
      },
      method: "POST",
    }
  ).catch(() => undefined);
}

/**
 * Fire-and-forget terminal dismiss: Skip never waits on it, and the write is
 * terminal-wins idempotent server-side, so a failure at worst re-shows the
 * dialog on the next entry.
 */
export function dismissOnboardingProfile(
  credentials: OnboardingFetcherCredentials,
  dismissedAtStep: number
): void {
  fetch(
    `/api/onboarding-profile/dismiss?namespace=${encodeURIComponent(credentials.namespace)}`,
    {
      body: JSON.stringify({ dismissedAtStep }),
      headers: {
        "content-type": "application/json",
        ...personalResourceAuthHeaders(credentials),
      },
      method: "POST",
    }
  ).catch(() => undefined);
}
