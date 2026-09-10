import assert from "node:assert/strict";
import { test } from "node:test";

import { getLangfuseConfigFromEnv } from "./langfuse-core";

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
});

test("does not accept the removed host environment variable", () => {
  assert.equal(
    getLangfuseConfigFromEnv({
      LANGFUSE_PUBLIC_KEY: "pk-lf-test",
      LANGFUSE_SECRET_KEY: "sk-lf-test",
      LANGFUSE_HOST: "https://langfuse.example.test",
    }),
    null
  );
});

test("trims credentials and requires an explicit host", () => {
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
    }),
    null
  );
});

for (const host of [undefined, "", "   "]) {
  test(`disables export when host is ${JSON.stringify(host)}`, () => {
    const env = {
      LANGFUSE_PUBLIC_KEY: "pk-test",
      LANGFUSE_SECRET_KEY: "sk-test",
      LANGFUSE_BASE_URL: host,
    };
    assert.equal(getLangfuseConfigFromEnv(env), null);
  });
}

test("allows explicitly configured Langfuse Cloud", () => {
  assert.equal(
    getLangfuseConfigFromEnv({
      LANGFUSE_PUBLIC_KEY: "pk-test",
      LANGFUSE_SECRET_KEY: "sk-test",
      LANGFUSE_BASE_URL: "https://cloud.langfuse.com",
    })?.baseUrl,
    "https://cloud.langfuse.com"
  );
});
