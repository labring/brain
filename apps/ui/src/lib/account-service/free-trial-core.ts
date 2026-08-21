/**
 * Active Free Trial judgment over the account-service subscription/info
 * response (ADR-0065). Pure — the server-side caller and the Billing Area's
 * client-side render predicate both import from here so the trial definition
 * exists exactly once.
 */

/**
 * Outcome of judging a workspace's Active Free Trial:
 * - `trial` — confirmed Free plan in normal standing; the only state that may
 *   ever block chat.
 * - `not-trial` — a confirmed non-trial record (paid, PAYG, PAUSED, DEBT,
 *   unknown future statuses); bills `user`.
 * - `unknown` — the judgment failed or the payload was unparsable; fail-open
 *   (serve free while local count remains, degrade to `user` when exhausted).
 */
export type FreeTrialJudgment = "not-trial" | "trial" | "unknown";

export interface FreeTrialSubscriptionFacts {
  planName: string;
  status: string;
  type: string;
}

function normalized(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Upstream's own trial semantics: a Free plan subscription in normal
 * standing, all fields trimmed and case-insensitive. PAUSED Free is a
 * born-suspended no-trial state; expired trials join the paid DEBT pipeline;
 * unknown or future statuses are non-trial.
 */
export function isActiveFreeTrialSubscription(
  facts: FreeTrialSubscriptionFacts
): boolean {
  return (
    normalized(facts.type) === "subscription" &&
    normalized(facts.planName) === "free" &&
    normalized(facts.status) === "normal"
  );
}

function stringField(
  record: Record<string, unknown>,
  key: string
): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

/**
 * Judge the raw subscription/info response body. A payload that carries no
 * subscription record at all is `unknown` (fail-open, never blocks). A
 * non-SUBSCRIPTION `type` (PAYG) is a confirmed `not-trial` even without
 * PlanName/Status — upstream serializes a nil subscription as just
 * `{"type":"PAYG"}`. A SUBSCRIPTION record whose PlanName or Status is
 * missing or non-string is schema drift, not a confirmed state: it judges
 * `unknown` so a real trial never silently degrades to `user` billing.
 */
export function judgeFreeTrialFromSubscriptionInfo(
  payload: unknown
): FreeTrialJudgment {
  if (typeof payload !== "object" || payload == null) {
    return "unknown";
  }
  const subscription = (payload as Record<string, unknown>).subscription;
  if (typeof subscription !== "object" || subscription == null) {
    return "unknown";
  }
  const record = subscription as Record<string, unknown>;
  const type = stringField(record, "type");
  if (type == null) {
    return "unknown";
  }
  if (normalized(type) !== "subscription") {
    return "not-trial";
  }
  const planName = stringField(record, "PlanName");
  const status = stringField(record, "Status");
  if (planName == null || status == null) {
    return "unknown";
  }
  return isActiveFreeTrialSubscription({ planName, status, type })
    ? "trial"
    : "not-trial";
}
