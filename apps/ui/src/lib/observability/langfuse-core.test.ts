import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_LANGFUSE_BASE_URL,
  getLangfuseConfigFromEnv,
  isLangfusePartiallyConfiguredFromEnv,
} from "./langfuse-core";

test("disables Langfuse when credentials are absent or incomplete", () => {
  assert.equal(getLangfuseConfigFromEnv({}), null);
  assert.equal(
    getLangfuseConfigFromEnv({ LANGFUSE_PUBLIC_KEY: "pk-lf-test" }),
    null
  );
  assert.equal(
    getLangfuseConfigFromEnv({ LANGFUSE_SECRET_KEY: "sk-lf-test" }),
    null
  );
  assert.equal(
    isLangfusePartiallyConfiguredFromEnv({
      LANGFUSE_PUBLIC_KEY: "pk-lf-test",
    }),
    true
  );
  assert.equal(isLangfusePartiallyConfiguredFromEnv({}), false);
});

test("trims credentials and base URL and applies the Cloud default", () => {
  assert.deepEqual(
    getLangfuseConfigFromEnv({
      LANGFUSE_PUBLIC_KEY: " pk-lf-test ",
      LANGFUSE_SECRET_KEY: " sk-lf-test ",
      LANGFUSE_BASE_URL: " https://langfuse.example.test/// ",
    }),
    {
      publicKey: "pk-lf-test",
      secretKey: "sk-lf-test",
      baseUrl: "https://langfuse.example.test",
    }
  );
  assert.equal(
    getLangfuseConfigFromEnv({
      LANGFUSE_PUBLIC_KEY: "pk-lf-test",
      LANGFUSE_SECRET_KEY: "sk-lf-test",
      LANGFUSE_BASE_URL: "   ",
    })?.baseUrl,
    DEFAULT_LANGFUSE_BASE_URL
  );
});
