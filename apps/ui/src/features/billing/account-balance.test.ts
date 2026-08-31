import assert from "node:assert/strict";
import { test } from "node:test";

import { loadAccountBalance } from "./account-balance";

test("loads the verified account's net Account Balance", async () => {
  let requestInput: RequestInfo | URL | undefined;
  let requestInit: RequestInit | undefined;
  const balance = await loadAccountBalance(
    {
      appToken: "desktop-app-token",
      currency: "usd",
      kubeconfig: "apiVersion: v1",
    },
    (input, init) => {
      requestInput = input;
      requestInit = init;
      return Promise.resolve(
        Response.json({
          account: {
            Balance: 4_200_000,
            DeductionBalance: 1_200_000,
          },
        })
      );
    }
  );

  assert.equal(requestInput?.toString(), "/api/billing/account");
  const headers = new Headers(requestInit?.headers);
  assert.equal(headers.get("Authorization"), "Bearer apiVersion%3A%20v1");
  assert.equal(headers.get("X-Sealos-App-Token"), "desktop-app-token");
  assert.equal(requestInit?.cache, "no-store");
  assert.deepEqual(balance, {
    currency: "usd",
    lifetimeDeductionMicroUnits: 1_200_000,
    microUnits: 3_000_000,
  });
});
