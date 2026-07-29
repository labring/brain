import assert from "node:assert/strict";
import { test } from "node:test";

import { getDevboxExecRequestTimeoutMs } from "./client-core";
import {
  getDevboxAuthTokenFromEnv,
  getDevboxBaseUrlFromEnv,
  isDevboxConfiguredFromEnv,
} from "./config-core";

const MISSING_SIGNING_KEY_ERROR =
  /Missing required environment variable: DEVBOX_JWT_SIGNING_KEY/;

test("getDevboxBaseUrlFromEnv reads DEVBOX_API_BASE_URL", () => {
  assert.equal(
    getDevboxBaseUrlFromEnv({
      DEVBOX_API_BASE_URL: "https://devbox-server.example.sealos.io/",
    }),
    "https://devbox-server.example.sealos.io"
  );
});

test("getDevboxAuthTokenFromEnv prefers DEVBOX_TOKEN over signing key", async () => {
  assert.equal(
    await getDevboxAuthTokenFromEnv(
      { DEVBOX_TOKEN: "static-token" },
      "ns-user"
    ),
    "static-token"
  );
});

test("getDevboxAuthTokenFromEnv reports clear error when no auth source is configured", async () => {
  await assert.rejects(
    () => getDevboxAuthTokenFromEnv({}, "ns-user"),
    MISSING_SIGNING_KEY_ERROR
  );
});

test("isDevboxConfiguredFromEnv requires a base URL and one auth source", () => {
  assert.equal(
    isDevboxConfiguredFromEnv({
      DEVBOX_API_BASE_URL: "https://devbox-server.example.sealos.io",
      DEVBOX_TOKEN: "static-token",
    }),
    true
  );
  assert.equal(
    isDevboxConfiguredFromEnv({
      DEVBOX_API_BASE_URL: "https://devbox-server.example.sealos.io",
      DEVBOX_JWT_SIGNING_KEY: "signing-key",
    }),
    true
  );
});

test("isDevboxConfiguredFromEnv rejects blank or half-configured env", () => {
  assert.equal(isDevboxConfiguredFromEnv({}), false);
  assert.equal(
    isDevboxConfiguredFromEnv({
      DEVBOX_API_BASE_URL: "https://devbox-server.example.sealos.io",
    }),
    false
  );
  assert.equal(
    isDevboxConfiguredFromEnv({ DEVBOX_TOKEN: "static-token" }),
    false
  );
  assert.equal(
    isDevboxConfiguredFromEnv({
      DEVBOX_API_BASE_URL: "   ",
      DEVBOX_TOKEN: "   ",
    }),
    false
  );
});

test("getDevboxExecRequestTimeoutMs applies timeoutSeconds plus request buffer", () => {
  assert.equal(getDevboxExecRequestTimeoutMs(75), 85_000);
});
