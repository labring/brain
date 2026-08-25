import type { FreeTrialJudgment } from "@/lib/account-service/free-trial-core";

import type { FreeTierState } from "./types";

/** Usage-only view of a namespace's Free Chat Turns (no billing decision). */
export interface FreeTurnsSnapshot {
  limit: number;
  remaining: number;
}

/**
 * Chat Billing Posture for the next assistant turn (ADR-0065): Free Chat
 * Turns are a benefit of the Active Free Trial.
 *
 * - `free` while spendable turns remain, a platform model is configured, and
 *   the workspace is on a trial — or the judgment is `unknown` (fail-open:
 *   the console never yields to billing judgment).
 * - `blocked` only on a confirmed trial with the feature live (model
 *   configured, limit > 0) and the allowance exhausted.
 * - `user` everywhere else: paid plans, PAYG, PAUSED Free, expired trials,
 *   disabled feature (`FREE_CHAT_TURNS=0`), missing platform model, and the
 *   exhausted fail-open case.
 */
export function freeTierPosture(
  snapshot: FreeTurnsSnapshot,
  systemModelConfigured: boolean,
  trial: FreeTrialJudgment
): FreeTierState {
  const spendable =
    snapshot.remaining > 0 && systemModelConfigured && trial !== "not-trial";
  const blocked =
    snapshot.remaining === 0 &&
    snapshot.limit > 0 &&
    systemModelConfigured &&
    trial === "trial";
  let billing: FreeTierState["billing"] = "user";
  if (spendable) {
    billing = "free";
  } else if (blocked) {
    billing = "blocked";
  }
  return {
    billing,
    limit: snapshot.limit,
    remaining: snapshot.remaining,
  };
}

/**
 * Posture the client should hold once the current turn completes — what the
 * `X-Chat-*` response headers report. A `free` turn spends one Free Chat
 * Turn, so the turn that spends the last one already reports `blocked`: the
 * pane flips at exhaustion, not one message later.
 */
export function freeTierPostureAfterTurn(
  snapshot: FreeTurnsSnapshot,
  systemModelConfigured: boolean,
  trial: FreeTrialJudgment
): FreeTierState {
  const pre = freeTierPosture(snapshot, systemModelConfigured, trial);
  if (pre.billing !== "free") {
    return pre;
  }
  return freeTierPosture(
    { limit: snapshot.limit, remaining: Math.max(0, snapshot.remaining - 1) },
    systemModelConfigured,
    trial
  );
}
