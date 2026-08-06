import type { OnboardingFetcherCredentials } from "./client";
import type { OnboardingSamplingVerdict } from "./types";

/**
 * The Onboarding Gate's failure policy: silent, with at most 2 backoff
 * retries per session, then stand down — sampling is opportunistic and never
 * bought at the cost of console access.
 */
export const ONBOARDING_GATE_RETRY_DELAYS_MS = [1000, 3000] as const;

/** Credentials the Gate needs before it can judge anything this session. */
export function onboardingCredentialsReady(
  input: OnboardingFetcherCredentials
): boolean {
  return (
    input.appToken.trim() !== "" &&
    input.kubeconfig.trim() !== "" &&
    input.namespace.trim() !== ""
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Judges the sampling predicate once per session: `true` only on a definitive
 * Unsampled verdict — the single outcome that opens the dialog. An
 * `"unauthorized"` outcome fails closed at once — retrying the same
 * credentials cannot change that answer. A `null` verdict (network failure,
 * parse failure) is retried on the backoff schedule and then silently stands
 * down; the person is simply re-judged on their next entry.
 */
export async function judgeOnboardingSampling(input: {
  fetchVerdict: () => Promise<
    OnboardingSamplingVerdict | "unauthorized" | null
  >;
  /** Test seam; defaults to a real timer. */
  delay?: (ms: number) => Promise<void>;
}): Promise<boolean> {
  const delay = input.delay ?? wait;
  for (
    let attempt = 0;
    attempt <= ONBOARDING_GATE_RETRY_DELAYS_MS.length;
    attempt += 1
  ) {
    if (attempt > 0) {
      await delay(ONBOARDING_GATE_RETRY_DELAYS_MS[attempt - 1] ?? 0);
    }
    const verdict = await input.fetchVerdict().catch(() => null);
    if (verdict === "unauthorized") {
      return false;
    }
    if (verdict != null) {
      return !verdict.sampled;
    }
  }
  return false;
}
