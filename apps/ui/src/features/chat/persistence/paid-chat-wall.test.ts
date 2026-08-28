import { describe, expect, it } from "bun:test";

import type { WorkspaceBillingStanding } from "@/features/billing/server/billing-standing-core";

import { paidChatWall } from "./paid-chat-wall";

function standing(
  overrides: Partial<WorkspaceBillingStanding>
): WorkspaceBillingStanding {
  return {
    accountDebt: false,
    aiCredits: null,
    availableBalanceMicroUnits: 50_000_000,
    fullQuota: null,
    paidSource: "balance",
    quotaKnown: true,
    ...overrides,
  };
}

describe("paidChatWall", () => {
  it("walls a PAYG workspace in Account Debt on its balance", () => {
    expect(paidChatWall(standing({ accountDebt: true }))).toEqual({
      paidSource: "balance",
      wall: "balance",
    });
  });

  it("leaves a low-but-positive PAYG balance open — the $5 tier belongs to notifications", () => {
    expect(
      paidChatWall(
        standing({ accountDebt: false, availableBalanceMicroUnits: 400_000 })
      )
    ).toEqual({ paidSource: "balance", wall: null });
  });

  it("walls a subscribed workspace whose AI Credits are spent", () => {
    expect(
      paidChatWall(
        standing({
          aiCredits: { totalMicroUnits: 3_000_000, usedMicroUnits: 3_000_000 },
          paidSource: "ai-credits",
        })
      )
    ).toEqual({ paidSource: "ai-credits", wall: "ai-credits" });
  });

  it("keeps a subscribed workspace open while credits remain, even in Account Debt", () => {
    // AI Credits are workspace-scoped and subscription-funded (CONTEXT.md);
    // the account's cash is not what a subscribed turn spends.
    expect(
      paidChatWall(
        standing({
          accountDebt: true,
          aiCredits: { totalMicroUnits: 3_000_000, usedMicroUnits: 1_200_000 },
          paidSource: "ai-credits",
        })
      )
    ).toEqual({ paidSource: "ai-credits", wall: null });
  });

  it("never walls on a plan with no AI Credits allowance at all", () => {
    expect(
      paidChatWall(
        standing({
          aiCredits: { totalMicroUnits: 0, usedMicroUnits: 0 },
          paidSource: "ai-credits",
        })
      )
    ).toEqual({ paidSource: "ai-credits", wall: null });
  });

  it("fails open when the standing is unknown", () => {
    expect(
      paidChatWall(
        standing({ accountDebt: null, aiCredits: null, paidSource: null })
      )
    ).toEqual({ paidSource: null, wall: null });
  });
});
