import { mock } from "bun:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";

mock.module("server-only", () => ({}));

const JWT_AUTHORIZATION_RE = /^Bearer [^.]+\.[^.]+\.[^.]+$/;

const originalFetch = globalThis.fetch;
const originalGithubAppId = process.env.GITHUB_APP_ID;
const originalGithubOauthClientId = process.env.GITHUB_OAUTH_CLIENT_ID;
const originalGithubOauthClientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
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
      authorization = new Headers(init?.headers).get("Authorization") ?? "";
      return Promise.resolve(
        Response.json({
          html_url: "https://github.com/apps/sealos-dev",
          slug: "sealos-dev",
        })
      );
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

test("builds GitHub OAuth authorize URL with package scopes", async () => {
  process.env.GITHUB_OAUTH_CLIENT_ID = "oauth-client-id";
  try {
    const { buildGithubOAuthAuthorizeUrl } = await import("./app-auth");
    const url = new URL(
      buildGithubOAuthAuthorizeUrl({
        redirectUri: "http://localhost:3000/api/callback/github",
        scopes: ["repo", "read:packages", "write:packages"],
        state: "state-123",
      })
    );
    assert.equal(
      url.origin + url.pathname,
      "https://github.com/login/oauth/authorize"
    );
    assert.equal(url.searchParams.get("client_id"), "oauth-client-id");
    assert.equal(
      url.searchParams.get("redirect_uri"),
      "http://localhost:3000/api/callback/github"
    );
    assert.equal(
      url.searchParams.get("scope"),
      "repo read:packages write:packages"
    );
    assert.equal(url.searchParams.get("state"), "state-123");
    assert.equal(url.searchParams.get("prompt"), "select_account");
  } finally {
    if (originalGithubOauthClientId == null) {
      delete process.env.GITHUB_OAUTH_CLIENT_ID;
    } else {
      process.env.GITHUB_OAUTH_CLIENT_ID = originalGithubOauthClientId;
    }
  }
});

test("exchanges GitHub OAuth code with OAuth App credentials", async () => {
  process.env.GITHUB_OAUTH_CLIENT_ID = "oauth-client-id";
  process.env.GITHUB_OAUTH_CLIENT_SECRET = "oauth-client-secret";
  let requestBody = "";
  globalThis.fetch = ((_input, init) => {
    requestBody = String(init?.body ?? "");
    return Promise.resolve(
      Response.json({
        access_token: "gho_registry_token",
        scope: "repo,read:packages,write:packages",
        token_type: "bearer",
      })
    );
  }) as typeof fetch;
  try {
    const { exchangeGithubOAuthCode } = await import("./app-auth");
    const token = await exchangeGithubOAuthCode({
      code: "oauth-code",
      redirectUri: "http://localhost:3000/api/callback/github",
    });
    assert.equal(token.accessToken, "gho_registry_token");
    assert.equal(token.scope, "repo,read:packages,write:packages");
    const params = new URLSearchParams(requestBody);
    assert.equal(params.get("client_id"), "oauth-client-id");
    assert.equal(params.get("client_secret"), "oauth-client-secret");
    assert.equal(params.get("code"), "oauth-code");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalGithubOauthClientId == null) {
      delete process.env.GITHUB_OAUTH_CLIENT_ID;
    } else {
      process.env.GITHUB_OAUTH_CLIENT_ID = originalGithubOauthClientId;
    }
    if (originalGithubOauthClientSecret == null) {
      delete process.env.GITHUB_OAUTH_CLIENT_SECRET;
    } else {
      process.env.GITHUB_OAUTH_CLIENT_SECRET = originalGithubOauthClientSecret;
    }
  }
});
