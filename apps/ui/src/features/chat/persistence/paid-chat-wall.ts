import type { WorkspaceBillingStanding } from "@/features/billing/server/billing-standing-core";
import type { FreeTrialJudgment } from "@/lib/account-service/free-trial-core";

import type { ChatPaidSource, FreeTierState } from "./types";

/**
 * The paid-chat wall (design spec row E3), judged the way the Free Chat
 * Turns gate is (ADR-0065): on the server, before the turn, from the
 * workspace's billing standing. A subscribed workspace spends AI Credits and
 * is walled when its allowance is spent; a PAYG workspace spends the Account
 * Balance and is walled in Account Debt. A low-but-positive balance never
 * walls — that voice belongs to notifications. Unknown standing fails open.
 *
 * A subscribed workspace whose plan grants no AI Credits at all
 * (`total = 0` — the production Free plan, and any workspace upstream never
 * granted a quota package) is refused by aiproxy on every turn, balance
 * regardless, so it is walled with an `allowance-*` cause (ADR-0073): the
 * trial judgment picks whether the Free Chat Turns story explains the stop.
 */
export type PaidChatWall = Required<Pick<FreeTierState, "paidSource" | "wall">>;

/**
 * aiproxy refuses a group below this remainder before dispatch — its
 * `GroupMinimumBalance = 0.3` (core/middleware/distributor.go), here in the
 * account service's 1e6-per-currency-unit precision. Judged with `<` the
 * way aiproxy's `CheckBalance(amount) = balance >= amount` fails. If
 * upstream moves the constant, this mirror must follow (ADR-0073).
 */
export const AI_PROXY_MINIMUM_BALANCE_MICRO_UNITS = 300_000;

export function paidChatWall(
  standing: WorkspaceBillingStanding,
  trial: FreeTrialJudgment
): PaidChatWall {
  const paidSource: ChatPaidSource | null = standing.paidSource;
  if (paidSource === "balance") {
    return {
      paidSource,
      wall: standing.accountDebt === true ? "balance" : null,
    };
  }
  if (paidSource === "ai-credits") {
    const credits = standing.aiCredits;
    if (credits == null) {
      return { paidSource, wall: null };
    }
    if (credits.totalMicroUnits <= 0) {
      return {
        paidSource,
        wall: trial === "trial" ? "allowance-trial" : "allowance-plan",
      };
    }
    const remaining = credits.totalMicroUnits - credits.usedMicroUnits;
    return {
      paidSource,
      wall:
        remaining < AI_PROXY_MINIMUM_BALANCE_MICRO_UNITS ? "ai-credits" : null,
    };
  }
  return { paidSource: null, wall: null };
}
