import assert from "node:assert/strict";
import { test } from "node:test";

import { getDevboxExecRequestTimeoutMs } from "./client-core";
import {
  getDevboxAuthTokenFromEnv,
  getDevboxBaseUrlFromEnv,
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

test("getDevboxExecRequestTimeoutMs applies timeoutSeconds plus request buffer", () => {
  assert.equal(getDevboxExecRequestTimeoutMs(75), 85_000);
});
