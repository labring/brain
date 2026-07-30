import assert from "node:assert/strict";
import { test } from "node:test";

import { getBillingCurrencyFromEnv } from "./config-core";

const INVALID_BILLING_CURRENCY_RE = /BILLING_CURRENCY/;

test("Billing Currency defaults to usd and accepts configured cluster values", () => {
  assert.equal(getBillingCurrencyFromEnv({}), "usd");
  assert.equal(getBillingCurrencyFromEnv({ BILLING_CURRENCY: " cny " }), "cny");
  assert.equal(
    getBillingCurrencyFromEnv({ BILLING_CURRENCY: "shellCoin" }),
    "shellCoin"
  );
});

test("Billing Currency rejects unsupported configured values", () => {
  assert.throws(
    () => getBillingCurrencyFromEnv({ BILLING_CURRENCY: "eur" }),
    INVALID_BILLING_CURRENCY_RE
  );
});
