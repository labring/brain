import assert from "node:assert/strict";
import { test } from "node:test";

import { loadAccountCredits } from "./account-credits";

test("loads the remaining usable gift credits", async () => {
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
  assert.deepEqual(credits, { usableMicroUnits: 720_000 });
});

test("clamps over-consumed credits to zero", async () => {
  const credits = await loadAccountCredits(
    { appToken: "token", kubeconfig: "kc" },
    () =>
      Promise.resolve(
        Response.json({
          credits: { credits: 500_000, deductionCredits: 620_000 },
        })
      )
  );
  assert.deepEqual(credits, { usableMicroUnits: 0 });
});
