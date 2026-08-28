import { describe, expect, it } from "bun:test";

import {
  judgeWorkspaceBillingStanding,
  UNKNOWN_BILLING_STANDING,
} from "./billing-standing-core";

const HEALTHY_ACCOUNT = {
  account: { Balance: 128_000_000, DeductionBalance: 23_450_000 },
};
const DEBT_ACCOUNT = {
  account: { Balance: 5_000_000, DeductionBalance: 11_320_000 },
};
const NO_CREDITS = { credits: { credits: 0, deductionCredits: 0 } };
const PAYG = { subscription: { type: "PAYG" } };
const HOBBY = {
  subscription: { PlanName: "Hobby", Status: "NORMAL", type: "SUBSCRIPTION" },
};

function quota(input: {
  aiHard?: number;
  aiUsed?: number;
  storageUsed?: string;
}): unknown {
  return {
    quota: {
      hard: {
        "limits.cpu": "4",
        "limits.memory": "4Gi",
        "requests.storage": "20Gi",
        "services.nodeports": "8",
        ...(input.aiHard == null ? {} : { ai_quota: input.aiHard }),
      },
      used: {
        "limits.cpu": "1500m",
        "limits.memory": "3Gi",
        "requests.storage": input.storageUsed ?? "12Gi",
        "services.nodeports": "2",
        ...(input.aiUsed == null ? {} : { ai_quota: input.aiUsed }),
      },
    },
  };
}

describe("judgeWorkspaceBillingStanding", () => {
  it("reads a healthy PAYG workspace as open, paid from the balance", () => {
    const standing = judgeWorkspaceBillingStanding({
      account: HEALTHY_ACCOUNT,
      credits: NO_CREDITS,
      quota: quota({}),
      subscription: PAYG,
    });
    expect(standing).toEqual({
      accountDebt: false,
      aiCredits: null,
      availableBalanceMicroUnits: 104_550_000,
      fullQuota: null,
      paidSource: "balance",
      quotaKnown: true,
    });
  });

  it("judges Account Debt by the platform's formula: cash minus deductions plus usable credits", () => {
    const covered = judgeWorkspaceBillingStanding({
      account: DEBT_ACCOUNT,
      credits: { credits: { credits: 7_000_000, deductionCredits: 0 } },
      quota: quota({}),
      subscription: PAYG,
    });
    expect(covered.accountDebt).toBe(false);
    expect(covered.availableBalanceMicroUnits).toBe(680_000);

    const inDebt = judgeWorkspaceBillingStanding({
      account: DEBT_ACCOUNT,
      credits: NO_CREDITS,
      quota: quota({}),
      subscription: PAYG,
    });
    expect(inDebt.accountDebt).toBe(true);
    expect(inDebt.availableBalanceMicroUnits).toBe(-6_320_000);
  });

  it("treats a PAYG workspace the platform already reports in DEBT as Account Debt even when the money reads failed", () => {
    const standing = judgeWorkspaceBillingStanding({
      account: null,
      credits: null,
      quota: null,
      subscription: { subscription: { Status: "DEBT", type: "PAYG" } },
    });
    expect(standing.accountDebt).toBe(true);
    expect(standing.availableBalanceMicroUnits).toBeNull();
  });

  it("leaves Account Debt unknown while either money read is missing", () => {
    const standing = judgeWorkspaceBillingStanding({
      account: DEBT_ACCOUNT,
      credits: null,
      quota: quota({}),
      subscription: PAYG,
    });
    expect(standing.accountDebt).toBeNull();
  });

  it("reads a subscribed workspace's AI Credits and pays from them", () => {
    const standing = judgeWorkspaceBillingStanding({
      account: HEALTHY_ACCOUNT,
      credits: NO_CREDITS,
      quota: quota({ aiHard: 3_000_000, aiUsed: 1_200_000 }),
      subscription: HOBBY,
    });
    expect(standing.paidSource).toBe("ai-credits");
    expect(standing.aiCredits).toEqual({
      totalMicroUnits: 3_000_000,
      usedMicroUnits: 1_200_000,
    });
  });

  it("names the first deployable quota that is full and ignores traffic", () => {
    const standing = judgeWorkspaceBillingStanding({
      account: HEALTHY_ACCOUNT,
      credits: NO_CREDITS,
      quota: quota({ storageUsed: "20Gi" }),
      subscription: HOBBY,
    });
    expect(standing.fullQuota).toEqual({
      label: "Storage",
      percentUsed: 100,
      type: "storage",
    });
  });

  it("is entirely unknown when nothing answered", () => {
    expect(
      judgeWorkspaceBillingStanding({
        account: null,
        credits: null,
        quota: null,
        subscription: null,
      })
    ).toEqual(UNKNOWN_BILLING_STANDING);
    expect(UNKNOWN_BILLING_STANDING.quotaKnown).toBe(false);
  });
});
