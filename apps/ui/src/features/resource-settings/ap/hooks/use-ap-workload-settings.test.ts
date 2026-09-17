import assert from "node:assert/strict";
import { test } from "node:test";

import { apiErrorMessage } from "./use-ap-workload-settings";

function jsonStatusResponse(body: string, status = 404): Response {
  return new Response(body, {
    headers: { "content-type": "application/json" },
    status,
  });
}

test("apiErrorMessage prefers the Huma detail field", async () => {
  const message = await apiErrorMessage(
    jsonStatusResponse(
      '{"title":"Not Found","status":404,"detail":"AP not found","errors":[{"message":"deployments.apps \\"affine\\" not found"}]}'
    )
  );
  assert.equal(message, "AP not found");
});

test("apiErrorMessage falls back to the first nested error message", async () => {
  const message = await apiErrorMessage(
    jsonStatusResponse(
      '{"title":"Bad Request","status":400,"errors":[{"message":"envName is required"}]}'
    )
  );
  assert.equal(message, "envName is required");
});

test("apiErrorMessage falls back to title and status without detail", async () => {
  const message = await apiErrorMessage(
    jsonStatusResponse('{"title":"Forbidden","status":403}', 403)
  );
  assert.equal(message, "Forbidden (403).");
});

test("apiErrorMessage returns raw text for non-JSON error bodies", async () => {
  const message = await apiErrorMessage(
    new Response("upstream exploded", { status: 500 })
  );
  assert.equal(message, "upstream exploded");
});

test("apiErrorMessage describes empty error bodies by status", async () => {
  const message = await apiErrorMessage(new Response("", { status: 502 }));
  assert.equal(message, "Request failed (502).");
});
