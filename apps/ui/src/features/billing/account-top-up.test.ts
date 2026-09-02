import assert from "node:assert/strict";
import { test } from "node:test";

import { isPaidTopUpPayment, loadHasToppedUp } from "./account-top-up";

const CREDENTIALS = { appToken: "t", kubeconfig: "k" };

function fetchAnswering(payload: unknown) {
  let request: { body: unknown; url: string } | null = null;
  const fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    request = { body: JSON.parse(String(init?.body)), url: input.toString() };
    return Promise.resolve(Response.json(payload));
  };
  return { fetch, request: () => request };
}

test("a paid recharge anywhere in the account's history means the account topped up", async () => {
  const answering = fetchAnswering({
    payments: [
      { ID: "p1", Status: "PAID", Type: "SUBSCRIPTION" },
      { ID: "p2", Status: "PAID", Type: "ACCOUNT_RECHARGE" },
    ],
  });
  assert.equal(
    await loadHasToppedUp(
      CREDENTIALS,
      answering.fetch,
      () => new Date("2026-08-27T12:00:00Z")
    ),
    true
  );
  const request = answering.request();
  assert.equal(request?.url, "/api/billing/payments");
  assert.deepEqual(request?.body, {
    endTime: "2026-08-27T12:00:00.000Z",
    startTime: "2020-01-01T00:00:00.000Z",
  });
});

test("subscription payments, failed recharges, and an empty history are not top-ups", async () => {
  assert.equal(
    await loadHasToppedUp(
      CREDENTIALS,
      fetchAnswering({
        payments: [
          { Status: "PAID", Type: "SUBSCRIPTION" },
          { Status: "FAILED", Type: "RECHARGE" },
        ],
      }).fetch
    ),
    false
  );
  assert.equal(
    await loadHasToppedUp(
      CREDENTIALS,
      fetchAnswering({ payments: null }).fetch
    ),
    false
  );
  assert.equal(isPaidTopUpPayment({ Type: "RECHARGE" }), true);
});
