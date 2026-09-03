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

/**
 * One sampling judgment per session (page load) and credential identity:
 * remounts re-attach to the same promise instead of re-querying. Identity
 * swaps normally arrive via a fresh page load (the Desktop reloads the
 * iframe on account/region/workspace switches), but that is a Desktop
 * contract this app cannot enforce — so a changed credential key defensively
 * discards the old judgment rather than letting it speak for a new identity.
 */
let sessionJudgment: { key: string; promise: Promise<boolean> } | null = null;

/** Test seam. */
export function resetOnboardingGateSessionForTesting(): void {
  sessionJudgment = null;
}

/** Fingerprint of the credential identity a judgment is made for. */
export function onboardingCredentialsKey(
  input: OnboardingFetcherCredentials
): string {
  return [input.appToken.trim(), input.kubeconfig, input.namespace.trim()].join(
    "\u0000"
  );
}

/**
 * Returns the session judgment for `key`, starting one when none exists or
 * the key changed. `rekeyed` is true only on a mid-session identity change —
 * the caller must then drop any UI state the discarded judgment produced.
 */
export function obtainOnboardingSessionJudgment(input: {
  key: string;
  judge: () => Promise<boolean>;
}): { promise: Promise<boolean>; rekeyed: boolean } {
  const rekeyed = sessionJudgment !== null && sessionJudgment.key !== input.key;
  if (sessionJudgment === null || rekeyed) {
    sessionJudgment = { key: input.key, promise: input.judge() };
  }
  return { promise: sessionJudgment.promise, rekeyed };
}

/**
 * Overrides `key`'s session judgment with Sampled the moment a terminal
 * complete/dismiss fires: without this, a Gate remount under the same
 * credentials (client-side navigation away from and back to the console)
 * would re-attach to the stale Unsampled verdict and reopen the survey the
 * person just finished. Deliberately settled at the action, not at the
 * write's success — the judgment records "this person terminated the survey
 * this session", and re-asking someone who just declined would be worse
 * than a lost write, whose recovery is the database re-judgment on the next
 * page load. A judgment held by a different identity is not touched — the
 * terminal action wasn't theirs.
 */
export function settleOnboardingSessionJudgmentSampled(key: string): void {
  if (sessionJudgment === null || sessionJudgment.key === key) {
    sessionJudgment = { key, promise: Promise.resolve(false) };
  }
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

/**
 * Whether the sampling dialog is open this render. It opens for the
 * identity whose judgment opened it: on a mid-session rekey the rendered
 * credential key stops matching and the dialog closes in the same render —
 * whatever the discarded identity's judgment opened must not survive it;
 * credentials going momentarily unready (a null rendered key) leave an open
 * dialog open. And it waits while a Billing Escalation Dialog is open —
 * money and deletion outrank a survey (CONTEXT.md, Onboarding Gate) — then
 * opens on the next evaluation once that dialog has closed.
 */
export function onboardingDialogOpen(input: {
  billingEscalationOpen: boolean;
  /** The credential key whose judgment opened the dialog; null while closed. */
  openForKey: string | null;
  /** The key of the credentials rendering now; null while they are unready. */
  renderedKey: string | null;
}): boolean {
  if (input.billingEscalationOpen || input.openForKey === null) {
    return false;
  }
  return input.renderedKey === null || input.renderedKey === input.openForKey;
}
