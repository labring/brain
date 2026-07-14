import "server-only";

import { createPrivateKey } from "node:crypto";
import { SignJWT } from "jose";

const GITHUB_API = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";
const GITHUB_OAUTH_ACCESS_TOKEN_URL =
  "https://github.com/login/oauth/access_token";
const GITHUB_OAUTH_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";

export interface GithubAppInstallationMetadata {
  accountLogin: string;
  accountType: string;
  repositorySelection: string;
}

export interface GithubAppMetadata {
  htmlUrl: string;
  slug: string;
}

interface GithubAppResponse {
  html_url?: unknown;
  slug?: unknown;
}

interface GithubAppInstallationResponse {
  account?: {
    login?: unknown;
    type?: unknown;
  } | null;
  repository_selection?: unknown;
}

export interface GithubOAuthTokenResponse {
  accessToken: string;
  scope: string;
  tokenType: string;
}

interface GithubOAuthAccessTokenResponse {
  access_token?: unknown;
  error?: unknown;
  error_description?: unknown;
  scope?: unknown;
  token_type?: unknown;
}

interface GithubUserResponse {
  login?: unknown;
}

let githubAppMetadataCache: GithubAppMetadata | null = null;

function appIdFromEnv(): string {
  const appId = process.env.GITHUB_APP_ID?.trim();
  if (!appId) {
    throw new Error("GITHUB_APP_ID is required for GitHub App authentication.");
  }
  return appId;
}

function privateKeyFromEnv(): string {
  const raw = process.env.GITHUB_APP_PRIVATE_KEY?.trim();
  if (!raw) {
    throw new Error(
      "GITHUB_APP_PRIVATE_KEY is required for GitHub App authentication."
    );
  }
  return raw.includes("\\n") ? raw.replaceAll("\\n", "\n") : raw;
}

function oauthClientIdFromEnv(): string {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID?.trim();
  if (!clientId) {
    throw new Error(
      "GITHUB_OAUTH_CLIENT_ID is required for GitHub OAuth authorization."
    );
  }
  return clientId;
}

function oauthClientSecretFromEnv(): string {
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET?.trim();
  if (!clientSecret) {
    throw new Error(
      "GITHUB_OAUTH_CLIENT_SECRET is required for GitHub OAuth authorization."
    );
  }
  return clientSecret;
}

async function createGithubAppJwt(): Promise<string> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const key = createPrivateKey(privateKeyFromEnv());
  return await new SignJWT({})
    .setProtectedHeader({ alg: "RS256" })
    .setIssuedAt(nowSeconds - 60)
    .setExpirationTime(nowSeconds + 9 * 60)
    .setIssuer(appIdFromEnv())
    .sign(key);
}

function parseGithubOAuthTokenResponse(
  body: GithubOAuthAccessTokenResponse
): GithubOAuthTokenResponse {
  if (typeof body.error === "string" && body.error !== "") {
    throw new Error(
      typeof body.error_description === "string" && body.error_description
        ? `GitHub OAuth token request failed: ${body.error_description}`
        : `GitHub OAuth token request failed: ${body.error}`
    );
  }
  if (typeof body.access_token !== "string" || body.access_token === "") {
    throw new Error(
      "GitHub OAuth token response did not include access_token."
    );
  }
  return {
    accessToken: body.access_token,
    scope: typeof body.scope === "string" ? body.scope : "",
    tokenType:
      typeof body.token_type === "string" && body.token_type !== ""
        ? body.token_type
        : "bearer",
  };
}

export function buildGithubOAuthAuthorizeUrl(input: {
  redirectUri: string;
  scopes: string[];
  state: string;
}): string {
  const url = new URL(GITHUB_OAUTH_AUTHORIZE_URL);
  url.searchParams.set("client_id", oauthClientIdFromEnv());
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", input.scopes.join(" "));
  url.searchParams.set("state", input.state);
  return url.toString();
}

export async function exchangeGithubOAuthCode(input: {
  code: string;
  redirectUri: string;
}): Promise<GithubOAuthTokenResponse> {
  const code = input.code.trim();
  if (code === "") {
    throw new Error("GitHub OAuth authorization code is required.");
  }
  const body = new URLSearchParams({
    client_id: oauthClientIdFromEnv(),
    client_secret: oauthClientSecretFromEnv(),
    code,
    redirect_uri: input.redirectUri,
  });
  const res = await fetch(GITHUB_OAUTH_ACCESS_TOKEN_URL, {
    body,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });
  const payload = (await res.json()) as GithubOAuthAccessTokenResponse;
  if (!res.ok) {
    throw new Error(
      `GitHub OAuth token request failed with status ${res.status}.`
    );
  }
  return parseGithubOAuthTokenResponse(payload);
}

export async function getGithubUserLogin(accessToken: string): Promise<string> {
  const token = accessToken.trim();
  if (token === "") {
    throw new Error("GitHub user access token is required.");
  }
  const res = await fetch(`${GITHUB_API}/user`, {
    cache: "no-store",
    headers: githubUserTokenHeaders(token),
  });
  if (!res.ok) {
    throw new Error(`GitHub user lookup failed with status ${res.status}.`);
  }
  const body = (await res.json()) as GithubUserResponse;
  if (typeof body.login !== "string" || body.login === "") {
    throw new Error("GitHub user lookup did not include login.");
  }
  return body.login;
}

export async function createInstallationAccessToken(
  installationId: string
): Promise<string> {
  const jwt = await createGithubAppJwt();
  const res = await fetch(
    `${GITHUB_API}/app/installations/${encodeURIComponent(
      installationId
    )}/access_tokens`,
    {
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${jwt}`,
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
      },
      method: "POST",
    }
  );
  if (!res.ok) {
    throw new Error(
      `GitHub installation token request failed with status ${res.status}.`
    );
  }
  const body = (await res.json()) as { token?: unknown };
  if (typeof body.token !== "string" || body.token === "") {
    throw new Error(
      "GitHub installation token response did not include token."
    );
  }
  return body.token;
}

export function githubUserTokenHeaders(
  accessToken: string
): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${accessToken}`,
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
  };
}

export async function getGithubAppMetadata(): Promise<GithubAppMetadata> {
  if (githubAppMetadataCache != null) {
    return githubAppMetadataCache;
  }
  const jwt = await createGithubAppJwt();
  const res = await fetch(`${GITHUB_API}/app`, {
    cache: "no-store",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${jwt}`,
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
    },
  });
  if (!res.ok) {
    throw new Error(
      `GitHub App metadata request failed with status ${res.status}.`
    );
  }
  const body = (await res.json()) as GithubAppResponse;
  if (
    typeof body.slug !== "string" ||
    body.slug === "" ||
    typeof body.html_url !== "string" ||
    body.html_url === ""
  ) {
    throw new Error(
      "GitHub App metadata response did not include slug/html_url."
    );
  }
  githubAppMetadataCache = {
    htmlUrl: body.html_url,
    slug: body.slug,
  };
  return githubAppMetadataCache;
}

export async function getGithubAppInstallationMetadata(
  installationId: string
): Promise<GithubAppInstallationMetadata> {
  const jwt = await createGithubAppJwt();
  const res = await fetch(
    `${GITHUB_API}/app/installations/${encodeURIComponent(installationId)}`,
    {
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${jwt}`,
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
      },
    }
  );
  if (!res.ok) {
    throw new Error(
      `GitHub installation metadata request failed with status ${res.status}.`
    );
  }
  const body = (await res.json()) as GithubAppInstallationResponse;
  return {
    accountLogin:
      typeof body.account?.login === "string" && body.account.login !== ""
        ? body.account.login
        : `installation-${installationId}`,
    accountType:
      typeof body.account?.type === "string" && body.account.type !== ""
        ? body.account.type
        : "GitHubAppInstallation",
    repositorySelection:
      typeof body.repository_selection === "string" &&
      body.repository_selection !== ""
        ? body.repository_selection
        : "selected",
  };
}

export function githubInstallationHeaders(
  installationToken: string
): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${installationToken}`,
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
  };
}
