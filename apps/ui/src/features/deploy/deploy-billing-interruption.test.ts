import { describe, expect, it } from "bun:test";

import { deploymentBillingInterruption } from "./deploy-billing-interruption";

describe("deploymentBillingInterruption", () => {
  it("presents an exhausted balance with the top-up fix", () => {
    expect(
      deploymentBillingInterruption({
        billingEvidence: {
          availableBalanceMicroUnits: -6_320_000,
          checkedAt: "2026-08-28T10:00:00.000Z",
          kind: "account-debt",
        },
        reason: "balance-exhausted",
      })
    ).toEqual({
      body: "Your account balance ran out while this deployment was running, and pay-as-you-go workspaces are suspended. Top up to lift the suspension, then redeploy.",
      cta: {
        desktop: {
          app: "system-costcenter",
          label: "Top up in Sealos Desktop",
        },
        href: "/billing",
        label: "Top up balance",
      },
      icon: "wallet",
      title: "Account balance in debt",
    });
  });

  it("names the full quota when the evidence carries it, and stays generic otherwise", () => {
    expect(
      deploymentBillingInterruption({
        billingEvidence: {
          kind: "quota-full",
          label: "Storage",
          percentUsed: 100,
          type: "storage",
        },
        reason: "quota-exceeded",
      })
    ).toEqual({
      body: "This workspace doesn't have enough storage quota to finish the deployment. Free resources or upgrade the plan, then redeploy.",
      // Plan-first: the paid fix leads, usage stays the quiet second way out.
      cta: { href: "/billing?mode=upgrade", label: "Upgrade plan" },
      icon: "alert",
      secondaryCta: { href: "/billing/usage", label: "View usage" },
      title: "Storage quota is full",
    });
    expect(deploymentBillingInterruption({ reason: "quota-exceeded" })).toEqual(
      {
        body: "This workspace doesn't have enough quota to finish the deployment. Free resources or upgrade the plan, then redeploy.",
        cta: { href: "/billing?mode=upgrade", label: "Upgrade plan" },
        icon: "alert",
        secondaryCta: { href: "/billing/usage", label: "View usage" },
        title: "Resource quota is full",
      }
    );
  });

  it("the quota CTA forks on the subscription and steps aside at the plan ceiling", () => {
    expect(
      deploymentBillingInterruption(
        { reason: "quota-exceeded" },
        { payg: true }
      )?.cta.label
    ).toBe("Subscribe");
    expect(
      deploymentBillingInterruption(
        { reason: "quota-exceeded" },
        { planCeiling: true }
      )
    ).toEqual({
      body: "This workspace doesn't have enough quota to finish the deployment. Free resources or upgrade the plan, then redeploy.",
      cta: { href: "/billing/usage", label: "View usage" },
      icon: "alert",
      title: "Resource quota is full",
    });
  });

  it("is null for every other failure reason", () => {
    expect(deploymentBillingInterruption({ reason: "timeout" })).toBeNull();
    expect(deploymentBillingInterruption(null)).toBeNull();
  });
});
