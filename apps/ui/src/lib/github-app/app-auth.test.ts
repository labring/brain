import { mock } from "bun:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";

mock.module("server-only", () => ({}));

const JWT_AUTHORIZATION_RE = /^Bearer [^.]+\.[^.]+\.[^.]+$/;

const originalFetch = globalThis.fetch;
const originalGithubAppId = process.env.GITHUB_APP_ID;
const originalGithubAppPrivateKey = process.env.GITHUB_APP_PRIVATE_KEY;

function withGithubAppEnv<T>(
  privateKey: string,
  run: () => Promise<T>
): Promise<T> {
  process.env.GITHUB_APP_ID = "12345";
  process.env.GITHUB_APP_PRIVATE_KEY = privateKey;
  return run().finally(() => {
    if (originalGithubAppId == null) {
      delete process.env.GITHUB_APP_ID;
    } else {
      process.env.GITHUB_APP_ID = originalGithubAppId;
    }
    if (originalGithubAppPrivateKey == null) {
      delete process.env.GITHUB_APP_PRIVATE_KEY;
    } else {
      process.env.GITHUB_APP_PRIVATE_KEY = originalGithubAppPrivateKey;
    }
    globalThis.fetch = originalFetch;
  });
}

function rsaPrivateKey(format: "pkcs1" | "pkcs8"): string {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return privateKey.export({ format: "pem", type: format }).toString();
}

async function assertMetadataRequestUsesJwt(privateKey: string) {
  await withGithubAppEnv(privateKey, async () => {
    let authorization = "";
    globalThis.fetch = ((_input, init) => {
      authorization = String(init?.headers?.Authorization ?? "");
      return Response.json({
        html_url: "https://github.com/apps/sealos-dev",
        slug: "sealos-dev",
      });
    }) as typeof fetch;

    const { getGithubAppInstallationMetadata } = await import("./app-auth");
    const metadata = await getGithubAppInstallationMetadata("123");
    assert.deepEqual(metadata, {
      accountLogin: "installation-123",
      accountType: "GitHubAppInstallation",
      repositorySelection: "selected",
    });
    assert.match(authorization, JWT_AUTHORIZATION_RE);
  });
}

test("accepts GitHub downloaded PKCS#1 RSA private keys", async () => {
  await assertMetadataRequestUsesJwt(rsaPrivateKey("pkcs1"));
});

test("accepts PKCS#8 private keys", async () => {
  await assertMetadataRequestUsesJwt(rsaPrivateKey("pkcs8"));
});
