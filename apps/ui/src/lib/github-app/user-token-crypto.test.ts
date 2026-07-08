// @ts-expect-error bun exposes mock at runtime; direct tsc in this repo lacks bun:test types.
import { mock } from "bun:test";
import assert from "node:assert/strict";
import { test } from "node:test";

mock.module("server-only", () => ({}));

const originalSecret = process.env.GITHUB_USER_TOKEN_ENCRYPTION_KEY;

test("encrypts and decrypts GitHub user tokens", async () => {
  process.env.GITHUB_USER_TOKEN_ENCRYPTION_KEY = "test-secret";
  try {
    const { decryptGithubUserToken, encryptGithubUserToken } = await import(
      "./user-token-crypto"
    );
    const encrypted = encryptGithubUserToken("gho_example");
    assert.notEqual(encrypted, "gho_example");
    assert.equal(decryptGithubUserToken(encrypted), "gho_example");
  } finally {
    if (originalSecret == null) {
      delete process.env.GITHUB_USER_TOKEN_ENCRYPTION_KEY;
    } else {
      process.env.GITHUB_USER_TOKEN_ENCRYPTION_KEY = originalSecret;
    }
  }
});

test("rejects ciphertext encrypted with a different key", async () => {
  process.env.GITHUB_USER_TOKEN_ENCRYPTION_KEY = "first-secret";
  try {
    const { decryptGithubUserToken, encryptGithubUserToken } = await import(
      "./user-token-crypto"
    );
    const encrypted = encryptGithubUserToken("gho_example");
    process.env.GITHUB_USER_TOKEN_ENCRYPTION_KEY = "second-secret";
    assert.throws(() => decryptGithubUserToken(encrypted));
  } finally {
    if (originalSecret == null) {
      delete process.env.GITHUB_USER_TOKEN_ENCRYPTION_KEY;
    } else {
      process.env.GITHUB_USER_TOKEN_ENCRYPTION_KEY = originalSecret;
    }
  }
});
