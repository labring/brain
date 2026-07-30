import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertProductionAccountServiceConfig,
  getAccountServiceConfigFromEnv,
  isAccountServiceConfiguredFromEnv,
} from "./config-core";

const MISSING_BASE_URL_ERROR = /ACCOUNT_API_BASE_URL/;
const MISSING_SIGNING_SECRET_ERROR = /JWT_INTERNAL/;

test("reads explicit account-service configuration", () => {
  assert.deepEqual(
    getAccountServiceConfigFromEnv({
      ACCOUNT_API_BASE_URL: " https://account-api.example.test/ ",
      JWT_INTERNAL: " signing-secret ",
    }),
    {
      baseUrl: "https://account-api.example.test",
      signingSecret: "signing-secret",
    }
  );
});

test("treats blank and half-configured account-service env as unconfigured", () => {
  assert.equal(isAccountServiceConfiguredFromEnv({}), false);
  assert.equal(
    isAccountServiceConfiguredFromEnv({
      ACCOUNT_API_BASE_URL: "https://account-api.example.test",
    }),
    false
  );
  assert.equal(
    isAccountServiceConfiguredFromEnv({ JWT_INTERNAL: "signing-secret" }),
    false
  );
  assert.equal(
    isAccountServiceConfiguredFromEnv({
      ACCOUNT_API_BASE_URL: "   ",
      JWT_INTERNAL: "   ",
    }),
    false
  );
  assert.equal(
    isAccountServiceConfiguredFromEnv({
      ACCOUNT_API_BASE_URL: "https://account-api.example.test",
      JWT_INTERNAL: "signing-secret",
    }),
    true
  );
});

test("throws when the account-service signing secret is missing or blank", () => {
  for (const signingSecret of [undefined, "   "]) {
    assert.throws(
      () =>
        getAccountServiceConfigFromEnv({
          ACCOUNT_API_BASE_URL: "https://account-api.example.test",
          JWT_INTERNAL: signingSecret,
        }),
      MISSING_SIGNING_SECRET_ERROR
    );
  }
});

test("production startup fails fast on incomplete account-service configuration", () => {
  assert.throws(
    () =>
      assertProductionAccountServiceConfig({
        JWT_INTERNAL: "signing-secret",
        NODE_ENV: "production",
      }),
    MISSING_BASE_URL_ERROR
  );
  assert.throws(
    () =>
      assertProductionAccountServiceConfig({
        ACCOUNT_API_BASE_URL: "https://account-api.example.test",
        JWT_INTERNAL: "  ",
        NODE_ENV: "production",
      }),
    MISSING_SIGNING_SECRET_ERROR
  );
  assert.doesNotThrow(() =>
    assertProductionAccountServiceConfig({ NODE_ENV: "development" })
  );
});
