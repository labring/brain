/**
 * The one budget every in-turn billing judgment shares (ADR-0065, ADR-0068):
 * the Active Free Trial judgment and the billing standing reads run in
 * parallel under a single deadline, so a stalled account service costs a
 * chat turn or a session bootstrap at most this long before failing open —
 * never one budget per read in series.
 */
export const BILLING_JUDGMENT_TIMEOUT_MS = 5000;
