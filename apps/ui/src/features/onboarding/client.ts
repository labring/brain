import { personalResourceAuthHeaders } from "@/lib/personal-resource-headers";

import {
  type AnswerOnboardingStepRequest,
  type CompleteOnboardingProfileRequest,
  type DismissOnboardingProfileRequest,
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

/**
 * Profile writes are fire-and-forget for the UI but ordered on the wire:
 * each write waits for the previous one to settle before it is sent. The
 * final answers never depend on this — the terminal write carries the whole
 * Terminal Snapshot — but ordering keeps the wire deterministic, so
 * terminal-wins is the only server-side guard the writes need.
 */
let onboardingWriteQueue: Promise<void> = Promise.resolve();

/** Test seam: the tail of the ordered write queue. */
export function onboardingWriteQueueSettled(): Promise<void> {
  return onboardingWriteQueue;
}

/** The shared fire-and-forget POST every profile write travels. */
function postOnboardingProfileWrite(
  credentials: OnboardingFetcherCredentials,
  path: "complete" | "dismiss" | "step",
  payload: unknown
): void {
  onboardingWriteQueue = onboardingWriteQueue.then(() =>
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
    ).then(
      () => undefined,
      () => undefined
    )
  );
}

/**
 * Fire-and-forget stepwise answer write, the abandonment safety net: Next
 * never waits on it, and a silent failure costs nothing final — a session
 * that reaches Submit or Skip re-sends every confirmed answer on the
 * terminal write's snapshot, and a session that abandons is still Unsampled
 * and re-asked on the next entry.
 */
export function answerOnboardingStep(
  credentials: OnboardingFetcherCredentials,
  payload: AnswerOnboardingStepRequest
): void {
  postOnboardingProfileWrite(credentials, "step", payload);
}

/**
 * Fire-and-forget terminal complete: Submit & Enter Console never waits on
 * it. The payload carries the Terminal Snapshot, so this one request is
 * sufficient for a complete row — no earlier stepwise write needs to have
 * landed. Terminal-wins keeps it idempotent server-side; a failure at worst
 * re-shows the dialog on the next entry.
 */
export function completeOnboardingProfile(
  credentials: OnboardingFetcherCredentials,
  payload: CompleteOnboardingProfileRequest
): void {
  postOnboardingProfileWrite(credentials, "complete", payload);
}

/**
 * Fire-and-forget terminal dismiss: Skip never waits on it. Like complete,
 * the payload carries the Terminal Snapshot of the steps confirmed before
 * the skip. Terminal-wins keeps it idempotent server-side; a failure at
 * worst re-shows the dialog on the next entry.
 */
export function dismissOnboardingProfile(
  credentials: OnboardingFetcherCredentials,
  payload: DismissOnboardingProfileRequest
): void {
  postOnboardingProfileWrite(credentials, "dismiss", payload);
}
