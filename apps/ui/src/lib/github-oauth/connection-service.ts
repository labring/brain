import "server-only";

import { eq } from "drizzle-orm";

import { getAssistantDb } from "@/lib/chat-persistence/db";
import {
  type GithubConnectionRow,
  githubConnections,
} from "@/lib/chat-persistence/schema";
import { normalizeAssistantNamespace } from "@/lib/chat-persistence/types";

import { decryptGithubToken, encryptGithubToken } from "./token-crypto";

const GITHUB_API = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";

export interface GithubRepoDTO {
  description: string | null;
  fullName: string;
  id: string;
  isPrivate: boolean;
  name: string;
  url: string;
}

export interface GithubConnectionDTO {
  githubLogin: string;
  isAuthorized: boolean;
  namespace: string;
  scope: string;
  updatedAt: string;
}

interface GithubUserResponse {
  login?: string;
}

interface GithubRepoResponse {
  description?: string | null;
  full_name?: string;
  html_url?: string;
  id?: number;
  name?: string;
  private?: boolean;
}

function githubHeaders(accessToken: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${accessToken}`,
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
  };
}

function toConnectionDTO(row: GithubConnectionRow): GithubConnectionDTO {
  return {
    githubLogin: row.githubLogin,
    isAuthorized: row.revokedAt == null,
    namespace: row.namespace,
    scope: row.scope,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function fetchGithubLogin(accessToken: string): Promise<string> {
  const res = await fetch(`${GITHUB_API}/user`, {
    cache: "no-store",
    headers: githubHeaders(accessToken),
  });
  if (!res.ok) {
    throw new Error(`GitHub user lookup failed with status ${res.status}.`);
  }
  const body = (await res.json()) as GithubUserResponse;
  return body.login?.trim() || "unknown";
}

export async function upsertGithubConnection(input: {
  accessToken: string;
  githubLogin: string;
  namespace: string;
  scope?: string;
  tokenType?: string;
}): Promise<GithubConnectionDTO> {
  const namespace = normalizeAssistantNamespace(input.namespace);
  const now = new Date();
  const encryptedAccessToken = encryptGithubToken(input.accessToken);
  const [row] = await getAssistantDb()
    .insert(githubConnections)
    .values({
      encryptedAccessToken,
      githubLogin: input.githubLogin,
      namespace,
      revokedAt: null,
      scope: input.scope?.trim() ?? "",
      tokenType: input.tokenType?.trim() || "bearer",
      updatedAt: now,
    })
    .onConflictDoUpdate({
      set: {
        encryptedAccessToken,
        githubLogin: input.githubLogin,
        revokedAt: null,
        scope: input.scope?.trim() ?? "",
        tokenType: input.tokenType?.trim() || "bearer",
        updatedAt: now,
      },
      target: githubConnections.namespace,
    })
    .returning();
  if (row == null) {
    throw new Error("Failed to store GitHub connection.");
  }
  return toConnectionDTO(row);
}

export async function getGithubConnection(
  namespace: string
): Promise<GithubConnectionDTO | null> {
  const [row] = await getAssistantDb()
    .select()
    .from(githubConnections)
    .where(
      eq(githubConnections.namespace, normalizeAssistantNamespace(namespace))
    )
    .limit(1);
  if (row == null || row.revokedAt != null) {
    return null;
  }
  return toConnectionDTO(row);
}

export async function getGithubAccessToken(
  namespace: string
): Promise<string | null> {
  const [row] = await getAssistantDb()
    .select()
    .from(githubConnections)
    .where(
      eq(githubConnections.namespace, normalizeAssistantNamespace(namespace))
    )
    .limit(1);
  if (row == null || row.revokedAt != null) {
    return null;
  }
  await getAssistantDb()
    .update(githubConnections)
    .set({ lastUsedAt: new Date(), updatedAt: new Date() })
    .where(eq(githubConnections.namespace, row.namespace));
  return decryptGithubToken(row.encryptedAccessToken);
}

function asGithubRepo(row: GithubRepoResponse): GithubRepoDTO | null {
  if (
    typeof row.id !== "number" ||
    typeof row.name !== "string" ||
    typeof row.full_name !== "string"
  ) {
    return null;
  }
  return {
    description: row.description ?? null,
    fullName: row.full_name,
    id: String(row.id),
    isPrivate: row.private ?? false,
    name: row.name,
    url: row.html_url ?? `https://github.com/${row.full_name}`,
  };
}

export async function listGithubReposForNamespace(
  namespace: string
): Promise<GithubRepoDTO[]> {
  const token = await getGithubAccessToken(namespace);
  if (token == null) {
    throw new Error("GitHub is not authorized for this namespace.");
  }

  const out: GithubRepoDTO[] = [];
  const perPage = 100;
  for (let page = 1; page <= 5; page += 1) {
    const url = new URL("/user/repos", GITHUB_API);
    url.searchParams.set("page", String(page));
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("sort", "updated");
    const res = await fetch(url.toString(), {
      cache: "no-store",
      headers: githubHeaders(token),
    });
    if (!res.ok) {
      throw new Error(
        `GitHub repositories request failed with status ${res.status}.`
      );
    }
    const payload = (await res.json()) as GithubRepoResponse[];
    const repos = Array.isArray(payload)
      ? payload.flatMap((row) => {
          const repo = asGithubRepo(row);
          return repo == null ? [] : [repo];
        })
      : [];
    if (repos.length === 0) {
      break;
    }
    out.push(...repos);
    if (repos.length < perPage) {
      break;
    }
  }
  return out;
}
