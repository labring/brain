import { describe, expect, it } from "bun:test";

import type { WorkspaceBillingStanding } from "@/features/billing/server/billing-standing-core";

import { resolveBillingFailureOverride } from "./billing-failure";

const CHECKED_AT = new Date("2026-08-28T10:00:00.000Z");

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

const DEBT = standing({
  accountDebt: true,
  availableBalanceMicroUnits: -6_320_000,
});
const STORAGE_FULL = standing({
  fullQuota: { label: "Storage", percentUsed: 100, type: "storage" },
});
/** A subscribed workspace whose account sits in debt: the plan carries it. */
const SUBSCRIBED_ACCOUNT_IN_DEBT = standing({
  accountDebt: true,
  aiCredits: { totalMicroUnits: 3_000_000, usedMicroUnits: 1_200_000 },
  availableBalanceMicroUnits: -6_320_000,
  paidSource: "ai-credits",
});

describe("resolveBillingFailureOverride", () => {
  it("reclassifies a runtime timeout as balance-exhausted when the account is in debt", () => {
    // A suspended workspace only ever looks like a timeout to the runner
    // (catalog E1); the billing reverse-check is what names the cause.
    expect(
      resolveBillingFailureOverride({
        now: CHECKED_AT,
        reason: "deploy-runtime-unavailable",
        standing: DEBT,
      })
    ).toEqual({
      billingEvidence: {
        availableBalanceMicroUnits: -6_320_000,
        checkedAt: "2026-08-28T10:00:00.000Z",
        kind: "account-debt",
      },
      reason: "balance-exhausted",
      supersedesRunnerError: true,
    });
  });

  it("lets debt supersede even an apply-time quota error", () => {
    // Suspension pins the namespace under a zero quota, so the provider's
    // "exceeded quota" is the debt speaking — its numbers would mislead.
    expect(
      resolveBillingFailureOverride({
        now: CHECKED_AT,
        reason: "quota-exceeded",
        standing: DEBT,
      })
    ).toMatchObject({
      reason: "balance-exhausted",
      supersedesRunnerError: true,
    });
  });

  it("never rewrites a subscribed workspace's failure on its account's debt", () => {
    // Account Debt suspends only PAYG workspaces (CONTEXT.md); a subscriber
    // at zero balance keeps the runner's own story — or the quota's.
    expect(
      resolveBillingFailureOverride({
        now: CHECKED_AT,
        reason: "deploy-runtime-unavailable",
        standing: SUBSCRIBED_ACCOUNT_IN_DEBT,
      })
    ).toBeNull();
    expect(
      resolveBillingFailureOverride({
        now: CHECKED_AT,
        reason: "quota-exceeded",
        standing: {
          ...SUBSCRIBED_ACCOUNT_IN_DEBT,
          fullQuota: { label: "Storage", percentUsed: 100, type: "storage" },
        },
      })
    ).toMatchObject({ reason: "quota-exceeded", supersedesRunnerError: false });
  });

  it("names the full quota behind a readiness timeout the runner could not attribute", () => {
    // Pods that cannot schedule look like a stall (catalog E2): the apply
    // succeeded, nothing became ready.
    expect(
      resolveBillingFailureOverride({
        now: CHECKED_AT,
        reason: "readiness-timeout",
        standing: STORAGE_FULL,
      })
    ).toEqual({
      billingEvidence: {
        kind: "quota-full",
        label: "Storage",
        percentUsed: 100,
        type: "storage",
      },
      reason: "quota-exceeded",
      // The runner's text was only a stall; it would contradict the headline.
      supersedesRunnerError: true,
    });
  });

  it("keeps an apply-time quota classification and only enriches it with the resource", () => {
    expect(
      resolveBillingFailureOverride({
        now: CHECKED_AT,
        reason: "quota-exceeded",
        standing: STORAGE_FULL,
      })
    ).toEqual({
      billingEvidence: {
        kind: "quota-full",
        label: "Storage",
        percentUsed: 100,
        type: "storage",
      },
      reason: "quota-exceeded",
      // The provider explained the quota itself; its numbers stay.
      supersedesRunnerError: false,
    });
    expect(
      resolveBillingFailureOverride({
        now: CHECKED_AT,
        reason: "quota-exceeded",
        standing: standing({}),
      })
    ).toBeNull();
  });

  it("leaves an apply error the provider explained alone, even with a full quota", () => {
    expect(
      resolveBillingFailureOverride({
        now: CHECKED_AT,
        reason: "apply-failed",
        standing: STORAGE_FULL,
      })
    ).toBeNull();
  });

  it("lets debt outrank a full quota", () => {
    expect(
      resolveBillingFailureOverride({
        now: CHECKED_AT,
        reason: "timeout",
        standing: standing({
          accountDebt: true,
          availableBalanceMicroUnits: null,
          fullQuota: { label: "CPU", percentUsed: 100, type: "cpu" },
        }),
      })?.reason
    ).toBe("balance-exhausted");
  });

  it("never rewrites a failure whose cause is already proven elsewhere", () => {
    for (const reason of [
      "cancelled",
      "github-authentication",
      "repository-clone-failed",
      "image-build-failed",
      "template-output-invalid",
      "deploy-skill-install-failed",
    ] as const) {
      expect(
        resolveBillingFailureOverride({
          now: CHECKED_AT,
          reason,
          standing: DEBT,
        })
      ).toBeNull();
    }
  });

  it("is silent on a healthy or unknown standing", () => {
    expect(
      resolveBillingFailureOverride({
        now: CHECKED_AT,
        reason: "timeout",
        standing: standing({}),
      })
    ).toBeNull();
    expect(
      resolveBillingFailureOverride({
        now: CHECKED_AT,
        reason: "timeout",
        standing: standing({ accountDebt: null, quotaKnown: false }),
      })
    ).toBeNull();
  });
});
