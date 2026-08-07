import type { MarketingTouch } from "./types";

export const MARKETING_CLICK_ID_COOLDOWN_MS = 6 * 60 * 60 * 1000;
export const MARKETING_CLICK_ID_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export type MarketingClickIdEligibility = "eligible" | "deferred" | "expired";

export function evaluateMarketingClickIdEligibility(
  touch: MarketingTouch,
  referenceTime = new Date()
): MarketingClickIdEligibility {
  const occurredAt = Date.parse(touch.ts);
  const referenceTimestamp = referenceTime.getTime();
  if (!(Number.isFinite(occurredAt) && Number.isFinite(referenceTimestamp))) {
    return "expired";
  }

  const age = referenceTimestamp - occurredAt;
  if (age < MARKETING_CLICK_ID_COOLDOWN_MS) {
    return "deferred";
  }
  if (age >= MARKETING_CLICK_ID_RETENTION_MS) {
    return "expired";
  }
  return "eligible";
}

/** Selects click-bearing touches for the scheduled Google upload worker. */
export function eligibleMarketingTouches(
  touches: readonly MarketingTouch[],
  referenceTime = new Date()
): MarketingTouch[] {
  return touches.filter(
    (touch) =>
      touch.click_id_value !== "" &&
      evaluateMarketingClickIdEligibility(touch, referenceTime) === "eligible"
  );
}
