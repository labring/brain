import { describe, expect, it } from "bun:test";

import {
  BILLING_DEV_MOCK_COOKIE,
  type BillingDevScenario,
} from "@/features/billing/dev-mock-cookie";

import {
  type BillingPayloadFetch,
  readWorkspaceBillingStanding,
} from "./billing-standing-reader";
import { billingDevMockResponse } from "./dev-fixtures";

/**
 * Pins the standing judgment to the billing Dev Mock scenarios through the
 * same reader the chat gate and the deploy failure reverse-check use, so
 * every interruption scene can be simulated locally and each scenario keeps
 * meaning what its name promises.
 */

function fixtureFetch(scenario: BillingDevScenario): BillingPayloadFetch {
  return async (pathname, body) => {
    const request = new Request(`http://brain.internal${pathname}`, {
      body: JSON.stringify(body),
      headers: { cookie: `${BILLING_DEV_MOCK_COOKIE}=${scenario}` },
      method: "POST",
    });
    const response = await billingDevMockResponse(pathname, request);
    if (response == null || !response.ok) {
      return null;
    }
    return await response.json();
  };
}

function read(scenario: BillingDevScenario) {
  return readWorkspaceBillingStanding(
    { regionDomain: "mock.sealos.run", workspace: "ns-test" },
    fixtureFetch(scenario)
  );
}

describe("workspace billing standing through the billing fixtures", () => {
  it("payg-debt is Account Debt paid from the balance", async () => {
    const standing = await read("payg-debt");
    expect(standing.accountDebt).toBe(true);
    expect(standing.paidSource).toBe("balance");
    expect(standing.fullQuota).toBeNull();
    expect(standing.quotaKnown).toBe(true);
  });

  it("payg stands clear", async () => {
    const standing = await read("payg");
    expect(standing.accountDebt).toBe(false);
    expect(standing.aiCredits).toBeNull();
  });

  it("quota-full names the full storage quota", async () => {
    const standing = await read("quota-full");
    expect(standing.accountDebt).toBe(false);
    expect(standing.fullQuota).toEqual({
      label: "Storage",
      percentUsed: 100,
      type: "storage",
    });
  });

  it("ai-credits-exhausted has spent every AI Credit of its plan", async () => {
    const standing = await read("ai-credits-exhausted");
    expect(standing.paidSource).toBe("ai-credits");
    expect(standing.aiCredits).not.toBeNull();
    expect(standing.aiCredits?.usedMicroUnits).toBe(
      standing.aiCredits?.totalMicroUnits ?? Number.NaN
    );
    expect(standing.accountDebt).toBe(false);
  });

  it("active still has AI Credits to spend", async () => {
    const standing = await read("active");
    expect(standing.paidSource).toBe("ai-credits");
    expect(standing.aiCredits?.usedMicroUnits).toBeLessThan(
      standing.aiCredits?.totalMicroUnits ?? 0
    );
  });

  it("a fetcher that throws leaves every fact unknown instead of failing", async () => {
    const standing = await readWorkspaceBillingStanding(
      { regionDomain: "mock.sealos.run", workspace: "ns-test" },
      () => Promise.reject(new Error("upstream down"))
    );
    expect(standing.accountDebt).toBeNull();
    expect(standing.paidSource).toBeNull();
    expect(standing.quotaKnown).toBe(false);
  });
});
