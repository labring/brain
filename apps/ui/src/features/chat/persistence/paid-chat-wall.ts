import type { WorkspaceBillingStanding } from "@/features/billing/server/billing-standing-core";

import type { ChatPaidSource, FreeTierState } from "./types";

/**
 * The paid-chat wall (design spec row E3), judged the way the Free Chat
 * Turns gate is (ADR-0065): on the server, before the turn, from the
 * workspace's billing standing. A subscribed workspace spends AI Credits and
 * is walled when its allowance is spent; a PAYG workspace spends the Account
 * Balance and is walled in Account Debt. A low-but-positive balance never
 * walls — that voice belongs to notifications. Unknown standing fails open.
 */
export type PaidChatWall = Required<Pick<FreeTierState, "paidSource" | "wall">>;

export function paidChatWall(standing: WorkspaceBillingStanding): PaidChatWall {
  const paidSource: ChatPaidSource | null = standing.paidSource;
  if (paidSource === "balance") {
    return {
      paidSource,
      wall: standing.accountDebt === true ? "balance" : null,
    };
  }
  if (paidSource === "ai-credits") {
    const credits = standing.aiCredits;
    const spent =
      credits != null &&
      credits.totalMicroUnits > 0 &&
      credits.usedMicroUnits >= credits.totalMicroUnits;
    return { paidSource, wall: spent ? "ai-credits" : null };
  }
  return { paidSource: null, wall: null };
}
