import type { FreeTierState } from "./types";

/** Usage-only view of a namespace's Free Chat Turns (no billing decision). */
export interface FreeTurnsSnapshot {
  limit: number;
  remaining: number;
}

/**
 * Chat Billing Posture for the next assistant turn (ADR 0033): `free` only
 * while spendable Free Chat Turns remain AND a platform model is configured.
 */
export function freeTierPosture(
  snapshot: FreeTurnsSnapshot,
  systemModelConfigured: boolean
): FreeTierState {
  return {
    billing: snapshot.remaining > 0 && systemModelConfigured ? "free" : "user",
    limit: snapshot.limit,
    remaining: snapshot.remaining,
  };
}

/**
 * Posture the client should hold once the current turn completes — what the
 * `X-Chat-*` response headers report. A `free` turn spends one Free Chat Turn,
 * so the turn that spends the last one already reports `user`: the pane hides
 * the Free counter and fires the crossing toast at exhaustion, not one paid
 * message later.
 */
export function freeTierPostureAfterTurn(
  snapshot: FreeTurnsSnapshot,
  systemModelConfigured: boolean
): FreeTierState {
  const pre = freeTierPosture(snapshot, systemModelConfigured);
  if (pre.billing !== "free") {
    return pre;
  }
  return freeTierPosture(
    { limit: snapshot.limit, remaining: Math.max(0, snapshot.remaining - 1) },
    systemModelConfigured
  );
}
