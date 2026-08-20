import assert from "node:assert/strict";
import { test } from "node:test";

import { sanitizeBillingReturnRoute } from "./billing-return-route";

test("sanitizeBillingReturnRoute accepts an in-app route outside /billing", () => {
  assert.equal(sanitizeBillingReturnRoute("/project"), "/project");
  assert.equal(
    sanitizeBillingReturnRoute("/project/abc?selected=db:main"),
    "/project/abc?selected=db:main"
  );
});

test("sanitizeBillingReturnRoute falls back to home for unusable values", () => {
  assert.equal(sanitizeBillingReturnRoute(null), "/");
  assert.equal(sanitizeBillingReturnRoute(""), "/");
  assert.equal(sanitizeBillingReturnRoute("https://evil.example"), "/");
  assert.equal(sanitizeBillingReturnRoute("//evil.example"), "/");
  assert.equal(sanitizeBillingReturnRoute("/billing"), "/");
  assert.equal(sanitizeBillingReturnRoute("/billing/costs"), "/");
  assert.equal(sanitizeBillingReturnRoute("/billing?mode=upgrade"), "/");
});
