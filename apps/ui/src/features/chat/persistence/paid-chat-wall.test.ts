import { describe, expect, it } from "bun:test";

import type { WorkspaceBillingStanding } from "@/features/billing/server/billing-standing-core";

import {
  AI_PROXY_MINIMUM_BALANCE_MICRO_UNITS,
  paidChatWall,
} from "./paid-chat-wall";

function standing(
  overrides: Partial<WorkspaceBillingStanding>
): WorkspaceBillingStanding {
  return {
    accountDebt: false,
    aiCredits: null,
    availableBalanceMicroUnits: 50_000_000,
    fullQuota: null,
    fullUniversalQuota: null,
    paidSource: "balance",
    paymentDue: false,
    paymentDueRecovery: null,
    quotaKnown: true,
    subscriptionPaused: false,
    ...overrides,
  };
}

describe("paidChatWall", () => {
  it("walls a PAYG workspace in Account Debt on its balance", () => {
    expect(paidChatWall(standing({ accountDebt: true }), "not-trial")).toEqual({
      paidSource: "balance",
      wall: "balance",
    });
  });

  it("leaves a low-but-positive PAYG balance open — the $5 tier belongs to notifications", () => {
    expect(
      paidChatWall(
        standing({ accountDebt: false, availableBalanceMicroUnits: 400_000 }),
        "not-trial"
      )
    ).toEqual({ paidSource: "balance", wall: null });
  });

  it("walls a subscribed workspace whose AI Credits are spent", () => {
    expect(
      paidChatWall(
        standing({
          aiCredits: { totalMicroUnits: 3_000_000, usedMicroUnits: 3_000_000 },
          paidSource: "ai-credits",
        }),
        "not-trial"
      )
    ).toEqual({ paidSource: "ai-credits", wall: "ai-credits" });
  });

  it("walls below aiproxy's minimum-balance floor, not only at zero (ADR-0073)", () => {
    // aiproxy refuses at remain < 0.3 (GroupMinimumBalance); a remainder
    // inside that dead zone would be refused upstream on every turn.
    expect(
      paidChatWall(
        standing({
          aiCredits: { totalMicroUnits: 3_000_000, usedMicroUnits: 2_800_000 },
          paidSource: "ai-credits",
        }),
        "not-trial"
      )
    ).toEqual({ paidSource: "ai-credits", wall: "ai-credits" });
  });

  it("mirrors aiproxy's floor exactly: open at 0.3 remaining, walled one unit below (ADR-0073)", () => {
    // aiproxy's CheckBalance passes at balance >= amount, so a remainder of
    // exactly GroupMinimumBalance still dispatches; the mirror must agree at
    // the edge, and the constant must stay the upstream 0.3 at 1e6 precision.
    expect(AI_PROXY_MINIMUM_BALANCE_MICRO_UNITS).toBe(300_000);
    const total = 3_000_000;
    expect(
      paidChatWall(
        standing({
          aiCredits: {
            totalMicroUnits: total,
            usedMicroUnits: total - AI_PROXY_MINIMUM_BALANCE_MICRO_UNITS,
          },
          paidSource: "ai-credits",
        }),
        "not-trial"
      )
    ).toEqual({ paidSource: "ai-credits", wall: null });
    expect(
      paidChatWall(
        standing({
          aiCredits: {
            totalMicroUnits: total,
            usedMicroUnits: total - AI_PROXY_MINIMUM_BALANCE_MICRO_UNITS + 1,
          },
          paidSource: "ai-credits",
        }),
        "not-trial"
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
        }),
        "not-trial"
      )
    ).toEqual({ paidSource: "ai-credits", wall: null });
  });

  it("walls a zero-allowance plan with the trial voice on an Active Free Trial (ADR-0073)", () => {
    // The production Free plan grants no AI Credits at all; upstream refuses
    // every user-billed turn regardless of the account balance.
    expect(
      paidChatWall(
        standing({
          aiCredits: { totalMicroUnits: 0, usedMicroUnits: 0 },
          paidSource: "ai-credits",
        }),
        "trial"
      )
    ).toEqual({ paidSource: "ai-credits", wall: "allowance-trial" });
  });

  it("walls a zero-allowance plan with the plan voice off-trial (ADR-0073)", () => {
    expect(
      paidChatWall(
        standing({
          aiCredits: { totalMicroUnits: 0, usedMicroUnits: 0 },
          paidSource: "ai-credits",
        }),
        "not-trial"
      )
    ).toEqual({ paidSource: "ai-credits", wall: "allowance-plan" });
  });

  it("speaks the plan voice when the trial judgment is unknown", () => {
    expect(
      paidChatWall(
        standing({
          aiCredits: { totalMicroUnits: 0, usedMicroUnits: 0 },
          paidSource: "ai-credits",
        }),
        "unknown"
      )
    ).toEqual({ paidSource: "ai-credits", wall: "allowance-plan" });
  });

  it("fails open when the credits read is unknown", () => {
    expect(
      paidChatWall(
        standing({ aiCredits: null, paidSource: "ai-credits" }),
        "not-trial"
      )
    ).toEqual({ paidSource: "ai-credits", wall: null });
  });

  it("fails open when the standing is unknown", () => {
    expect(
      paidChatWall(
        standing({ accountDebt: null, aiCredits: null, paidSource: null }),
        "not-trial"
      )
    ).toEqual({ paidSource: null, wall: null });
  });
});
