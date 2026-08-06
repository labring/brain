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
 * `"unauthorized"` on a definitive authorization refusal — retrying the same
 * credentials cannot change that answer, so the Gate fails closed at once.
 * `null` on any other failure (HTTP error, parse failure, network) — the
 * Gate retries it as an unknown outcome and then silently stands down.
 */
export async function fetchOnboardingSamplingVerdict(
  credentials: OnboardingFetcherCredentials
): Promise<OnboardingSamplingVerdict | "unauthorized" | null> {
  try {
    const res = await fetch(
      `/api/onboarding-profile/sampling?namespace=${encodeURIComponent(credentials.namespace)}`,
      { headers: personalResourceAuthHeaders(credentials) }
    );
    if (res.status === 401 || res.status === 403) {
      return "unauthorized";
    }
    if (!res.ok) {
      return null;
    }
    const parsed = onboardingSamplingVerdictSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The shared fire-and-forget POST every profile write travels. */
function postOnboardingProfileWrite(
  credentials: OnboardingFetcherCredentials,
  path: "complete" | "dismiss" | "step",
  payload: unknown
): void {
  fetch(
    `/api/onboarding-profile/${path}?namespace=${encodeURIComponent(credentials.namespace)}`,
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
 * Fire-and-forget stepwise answer write: Next never waits on it, and a
 * silent failure at worst re-asks the question on the next entry (the row
 * stays short of terminal, so the person is still Unsampled).
 */
export function answerOnboardingStep(
  credentials: OnboardingFetcherCredentials,
  payload: AnswerOnboardingStepRequest
): void {
  postOnboardingProfileWrite(credentials, "step", payload);
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
  postOnboardingProfileWrite(credentials, "complete", { openGoalText });
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
  postOnboardingProfileWrite(credentials, "dismiss", { dismissedAtStep });
}
