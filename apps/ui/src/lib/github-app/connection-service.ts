import "server-only";

import { generateId } from "ai";
import { and, desc, eq } from "drizzle-orm";

import { getAssistantDb } from "@/lib/chat-persistence/db";
import {
  type GithubConnectionRow,
  type GithubOauthConnectionRow,
  githubConnections,
  githubOauthConnections,
} from "@/lib/chat-persistence/schema";
import { normalizeAssistantNamespace } from "@/lib/chat-persistence/types";

import {
  type GithubOAuthTokenResponse,
  githubUserTokenHeaders,
} from "./app-auth";
import {
  decryptGithubUserToken,
  encryptGithubUserToken,
} from "./user-token-crypto";

const GITHUB_API = "https://api.github.com";

export interface GithubRepoDTO {
  description: string | null;
  fullName: string;
  id: string;
  isPrivate: boolean;
  name: string;
  url: string;
}

export interface GithubConnectionDTO {
  accountLogin: string;
  accountType: string;
  id: string;
  installationId: string;
  isAuthorized: boolean;
  namespace: string;
  repositorySelection: string;
  updatedAt: string;
}

interface GithubRepoResponse {
  description?: string | null;
  full_name?: string;
  html_url?: string;
  id?: number;
  name?: string;
  private?: boolean;
}

function toOauthConnectionDTO(
  row: GithubOauthConnectionRow
): GithubConnectionDTO {
  return {
    accountLogin: row.githubLogin,
    accountType: "User",
    id: row.id,
    installationId: "",
    isAuthorized: true,
    namespace: row.namespace,
    repositorySelection: "oauth",
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toAppConnectionDTO(row: GithubConnectionRow): GithubConnectionDTO {
  return {
    accountLogin: row.accountLogin,
    accountType: row.accountType,
    id: row.id,
    installationId: row.installationId,
    isAuthorized: row.revokedAt == null,
    namespace: row.namespace,
    repositorySelection: row.repositorySelection,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function upsertGithubAppConnection(input: {
  accountLogin: string;
  accountType?: string;
  actorUserId: string;
  installationId: string;
  namespace: string;
  repositorySelection?: string;
}): Promise<GithubConnectionDTO> {
  const namespace = normalizeAssistantNamespace(input.namespace);
  const actorUserId = input.actorUserId.trim();
  const installationId = input.installationId.trim();
  if (actorUserId === "") {
    throw new Error("GitHub App connection actor user ID is required.");
  }
  if (installationId === "") {
    throw new Error("GitHub App installation ID is required.");
  }

  const now = new Date();
  const [row] = await getAssistantDb()
    .insert(githubConnections)
    .values({
      accountLogin:
        input.accountLogin.trim() || `installation-${installationId}`,
      accountType: input.accountType?.trim() || "User",
      id: generateId(),
      installationId,
      installedByUserId: actorUserId,
      namespace,
      repositorySelection: input.repositorySelection?.trim() || "selected",
      revokedAt: null,
      type: "github_app",
      updatedAt: now,
    })
    .onConflictDoUpdate({
      set: {
        accountLogin:
          input.accountLogin.trim() || `installation-${installationId}`,
        accountType: input.accountType?.trim() || "User",
        installationId,
        installedByUserId: actorUserId,
        repositorySelection: input.repositorySelection?.trim() || "selected",
        revokedAt: null,
        type: "github_app",
        updatedAt: now,
      },
      target: githubConnections.namespace,
    })
    .returning();
  if (row == null) {
    throw new Error("Failed to store GitHub App connection.");
  }
  return toAppConnectionDTO(row);
}

export async function upsertGithubOauthConnection(input: {
  githubLogin: string;
  namespace: string;
  token: GithubOAuthTokenResponse;
  userId: string;
}): Promise<GithubConnectionDTO> {
  const namespace = normalizeAssistantNamespace(input.namespace);
  const userId = input.userId.trim();
  const githubLogin = input.githubLogin.trim();
  if (userId === "") {
    throw new Error("GitHub OAuth connection user ID is required.");
  }
  if (githubLogin === "") {
    throw new Error("GitHub OAuth connection login is required.");
  }

  const now = new Date();
  const [row] = await getAssistantDb()
    .insert(githubOauthConnections)
    .values({
      accessTokenCiphertext: encryptGithubUserToken(input.token.accessToken),
      githubLogin,
      id: generateId(),
      namespace,
      scope: input.token.scope,
      tokenType: input.token.tokenType,
      updatedAt: now,
      userId,
    })
    .onConflictDoUpdate({
      set: {
        accessTokenCiphertext: encryptGithubUserToken(input.token.accessToken),
        githubLogin,
        scope: input.token.scope,
        tokenType: input.token.tokenType,
        updatedAt: now,
      },
      target: [githubOauthConnections.namespace, githubOauthConnections.userId],
    })
    .returning();
  if (row == null) {
    throw new Error("Failed to store GitHub OAuth connection.");
  }
  return toOauthConnectionDTO(row);
}

export async function getGithubConnectionForNamespace(
  namespace: string,
  userId: string
): Promise<GithubConnectionDTO | null> {
  const [row] = await getAssistantDb()
    .select()
    .from(githubOauthConnections)
    .where(
      and(
        eq(
          githubOauthConnections.namespace,
          normalizeAssistantNamespace(namespace)
        ),
        eq(githubOauthConnections.userId, userId.trim())
      )
    )
    .orderBy(desc(githubOauthConnections.updatedAt))
    .limit(1);
  return row == null ? null : toOauthConnectionDTO(row);
}

export async function getGithubConnectionForNamespaceById(input: {
  connectionId: string;
  namespace: string;
  userId: string;
}): Promise<GithubConnectionDTO | null> {
  const [row] = await getAssistantDb()
    .select()
    .from(githubOauthConnections)
    .where(
      and(
        eq(githubOauthConnections.id, input.connectionId.trim()),
        eq(
          githubOauthConnections.namespace,
          normalizeAssistantNamespace(input.namespace)
        ),
        eq(githubOauthConnections.userId, input.userId.trim())
      )
    )
    .limit(1);
  return row == null ? null : toOauthConnectionDTO(row);
}

export async function revokeGithubConnectionForNamespace(
  namespace: string,
  userId: string
): Promise<void> {
  await getAssistantDb()
    .delete(githubOauthConnections)
    .where(
      and(
        eq(
          githubOauthConnections.namespace,
          normalizeAssistantNamespace(namespace)
        ),
        eq(githubOauthConnections.userId, userId.trim())
      )
    );
}

export async function getGithubOAuthTokenForConnection(input: {
  connectionId: string;
  namespace: string;
  userId: string;
}): Promise<string | null> {
  const [row] = await getAssistantDb()
    .select()
    .from(githubOauthConnections)
    .where(
      and(
        eq(githubOauthConnections.id, input.connectionId.trim()),
        eq(
          githubOauthConnections.namespace,
          normalizeAssistantNamespace(input.namespace)
        ),
        eq(githubOauthConnections.userId, input.userId.trim())
      )
    )
    .limit(1);
  if (row == null) {
    return null;
  }
  await getAssistantDb()
    .update(githubOauthConnections)
    .set({ lastUsedAt: new Date(), updatedAt: new Date() })
    .where(eq(githubOauthConnections.id, row.id));
  return decryptGithubUserToken(row.accessTokenCiphertext);
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
  namespace: string,
  userId: string
): Promise<GithubRepoDTO[]> {
  const connection = await getGithubConnectionForNamespace(namespace, userId);
  if (connection == null) {
    throw new Error("GitHub OAuth connection is not authorized.");
  }
  const token = await getGithubOAuthTokenForConnection({
    connectionId: connection.id,
    namespace,
    userId,
  });
  if (token == null) {
    throw new Error("GitHub OAuth connection is not authorized.");
  }

  const out: GithubRepoDTO[] = [];
  const perPage = 100;
  for (let page = 1; page <= 5; page += 1) {
    const url = new URL("/user/repos", GITHUB_API);
    url.searchParams.set(
      "affiliation",
      "owner,collaborator,organization_member"
    );
    url.searchParams.set("page", String(page));
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("sort", "updated");
    const res = await fetch(url.toString(), {
      cache: "no-store",
      headers: githubUserTokenHeaders(token),
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
