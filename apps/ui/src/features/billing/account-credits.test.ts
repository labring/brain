import assert from "node:assert/strict";
import { test } from "node:test";

import { loadAccountCredits } from "./account-credits";

test("loads the remaining usable and gift credits", async () => {
  let requestInput: RequestInfo | URL | undefined;
  let requestInit: RequestInit | undefined;
  const credits = await loadAccountCredits(
    {
      appToken: "desktop-app-token",
      kubeconfig: "apiVersion: v1",
    },
    (input, init) => {
      requestInput = input;
      requestInit = init;
      return Promise.resolve(
        Response.json({
          credits: {
            balance: 0,
            credits: 1_000_000,
            deductionBalance: 0,
            deductionCredits: 280_000,
            kycDeductionCreditsBalance: 1_000_000,
            kycDeductionCreditsDeductionBalance: 280_000,
          },
        })
      );
    }
  );

  assert.equal(requestInput?.toString(), "/api/billing/credits");
  const headers = new Headers(requestInit?.headers);
  assert.equal(headers.get("Authorization"), "Bearer apiVersion%3A%20v1");
  assert.equal(headers.get("X-Sealos-App-Token"), "desktop-app-token");
  assert.equal(requestInit?.cache, "no-store");
  assert.deepEqual(credits, {
    giftMicroUnits: 720_000,
    usableMicroUnits: 720_000,
  });
});

test("a paid plan's grant feeds the usable total but not the gift", async () => {
  // The aggregate covers every active Credits row; the KYC pair is the
  // new-user gift alone. A paid plan with remaining plan credits must not
  // surface them as a gift.
  const credits = await loadAccountCredits(
    { appToken: "token", kubeconfig: "kc" },
    () =>
      Promise.resolve(
        Response.json({
          credits: {
            credits: 3_000_000,
            currentPlanCreditsBalance: 3_000_000,
            currentPlanCreditsDeductionBalance: 1_200_000,
            deductionCredits: 1_200_000,
            kycDeductionCreditsBalance: 0,
            kycDeductionCreditsDeductionBalance: 0,
          },
        })
      )
  );
  assert.deepEqual(credits, {
    giftMicroUnits: 0,
    usableMicroUnits: 1_800_000,
  });
});

test("clamps over-consumed credits to zero", async () => {
  const credits = await loadAccountCredits(
    { appToken: "token", kubeconfig: "kc" },
    () =>
      Promise.resolve(
        Response.json({
          credits: {
            credits: 500_000,
            deductionCredits: 620_000,
            kycDeductionCreditsBalance: 500_000,
            kycDeductionCreditsDeductionBalance: 620_000,
          },
        })
      )
  );
  assert.deepEqual(credits, { giftMicroUnits: 0, usableMicroUnits: 0 });
});

test("caps the gift at the aggregate usable total", async () => {
  // An expired gift row drops out of the aggregate before the KYC pair
  // reflects it; the chip must never claim more than the account can spend.
  const credits = await loadAccountCredits(
    { appToken: "token", kubeconfig: "kc" },
    () =>
      Promise.resolve(
        Response.json({
          credits: {
            credits: 400_000,
            deductionCredits: 100_000,
            kycDeductionCreditsBalance: 1_000_000,
            kycDeductionCreditsDeductionBalance: 0,
          },
        })
      )
  );
  assert.deepEqual(credits, {
    giftMicroUnits: 300_000,
    usableMicroUnits: 300_000,
  });
});
