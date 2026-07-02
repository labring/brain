import "server-only";

import { createPrivateKey } from "node:crypto";
import { SignJWT } from "jose";

const GITHUB_API = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";

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
