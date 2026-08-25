import assert from "node:assert/strict";
import { test } from "node:test";

import {
  getBillingCurrencyFromEnv,
  getBillingGpuEnabledFromEnv,
} from "./config-core";

const INVALID_BILLING_CURRENCY_RE = /BILLING_CURRENCY/;
const INVALID_BILLING_GPU_FLAG_RE = /BILLING_GPU_ENABLED/;

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

test("Billing GPU visibility defaults off and accepts explicit boolean values", () => {
  assert.equal(getBillingGpuEnabledFromEnv({}), false);
  assert.equal(
    getBillingGpuEnabledFromEnv({ BILLING_GPU_ENABLED: " true " }),
    true
  );
  assert.equal(
    getBillingGpuEnabledFromEnv({ BILLING_GPU_ENABLED: "false" }),
    false
  );
});

test("Billing GPU visibility rejects malformed configured values", () => {
  assert.throws(
    () => getBillingGpuEnabledFromEnv({ BILLING_GPU_ENABLED: "enabled" }),
    INVALID_BILLING_GPU_FLAG_RE
  );
});
