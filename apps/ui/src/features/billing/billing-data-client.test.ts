import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BILLING_PERMISSION_DENIED_MESSAGE,
  BillingRequestError,
  createBillingJsonRequester,
} from "./billing-data-client";

const CREDENTIALS = { appToken: "token", kubeconfig: "kubeconfig" };

function requesterReturning(status: number, payload: unknown) {
  return createBillingJsonRequester({
    credentials: CREDENTIALS,
    fallbackErrorMessage: "Could not load billing plan data.",
    fetch: () =>
      Promise.resolve(
        new Response(JSON.stringify(payload), {
          headers: { "Content-Type": "application/json" },
          status,
        })
      ),
  });
}

test("a 403 is voiced as a billing permission verdict", async () => {
  // AIM-257: a non-owner's billing action bounced by account-service must
  // read as "no permission", not as the upstream's raw error internals.
  const request = requesterReturning(403, {
    error: "permission denied: role DEVELOPER cannot operate subscription",
  });
  await assert.rejects(request("/api/billing/subscription/pay", {}), {
    message: BILLING_PERMISSION_DENIED_MESSAGE,
    status: 403,
  });
});

test("other failures keep the upstream error message", async () => {
  const request = requesterReturning(409, { error: "plan change pending" });
  await assert.rejects(request("/api/billing/subscription/pay", {}), {
    message: "plan change pending",
    status: 409,
  });
});

test("failures without a payload message fall back per requester", async () => {
  const request = requesterReturning(500, {});
  await assert.rejects(
    request("/api/billing/subscription"),
    (error: unknown) => {
      assert.ok(error instanceof BillingRequestError);
      assert.equal(error.message, "Could not load billing plan data.");
      return true;
    }
  );
});
