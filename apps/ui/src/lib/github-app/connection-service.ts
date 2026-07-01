import "server-only";

import { generateId } from "ai";
import { and, desc, eq } from "drizzle-orm";

import { getAssistantDb } from "@/lib/chat-persistence/db";
import {
  type GithubConnectionRow,
  githubConnections,
} from "@/lib/chat-persistence/schema";
import { normalizeAssistantNamespace } from "@/lib/chat-persistence/types";

import {
  createInstallationAccessToken,
  githubInstallationHeaders,
} from "./app-auth";

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

interface GithubInstallationRepoResponse {
  repositories?: GithubRepoResponse[];
}

interface GithubRepoResponse {
  description?: string | null;
  full_name?: string;
  html_url?: string;
  id?: number;
  name?: string;
  private?: boolean;
}

function toConnectionDTO(row: GithubConnectionRow): GithubConnectionDTO {
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

function connectionIdNamespaceWhere(input: {
  connectionId: string;
  namespace: string;
}) {
  return and(
    eq(githubConnections.id, input.connectionId.trim()),
    eq(
      githubConnections.namespace,
      normalizeAssistantNamespace(input.namespace)
    ),
    eq(githubConnections.type, "github_app")
  );
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
  return toConnectionDTO(row);
}

export async function getGithubConnectionForNamespace(
  namespace: string
): Promise<GithubConnectionDTO | null> {
  const [row] = await getAssistantDb()
    .select()
    .from(githubConnections)
    .where(
      and(
        eq(githubConnections.namespace, normalizeAssistantNamespace(namespace)),
        eq(githubConnections.type, "github_app")
      )
    )
    .orderBy(desc(githubConnections.updatedAt))
    .limit(1);
  if (row == null || row.revokedAt != null) {
    return null;
  }
  return toConnectionDTO(row);
}

export async function getGithubConnectionForNamespaceById(input: {
  connectionId: string;
  namespace: string;
}): Promise<GithubConnectionDTO | null> {
  const [row] = await getAssistantDb()
    .select()
    .from(githubConnections)
    .where(connectionIdNamespaceWhere(input))
    .limit(1);
  if (row == null || row.revokedAt != null) {
    return null;
  }
  return toConnectionDTO(row);
}

export async function revokeGithubConnectionForNamespace(
  namespace: string
): Promise<void> {
  const now = new Date();
  await getAssistantDb()
    .update(githubConnections)
    .set({ revokedAt: now, updatedAt: now })
    .where(
      and(
        eq(githubConnections.namespace, normalizeAssistantNamespace(namespace)),
        eq(githubConnections.type, "github_app")
      )
    );
}

export async function getGithubInstallationToken(input: {
  connectionId: string;
  namespace: string;
}): Promise<string | null> {
  const [row] = await getAssistantDb()
    .select()
    .from(githubConnections)
    .where(connectionIdNamespaceWhere(input))
    .limit(1);
  if (row == null || row.revokedAt != null) {
    return null;
  }
  const token = await createInstallationAccessToken(row.installationId);
  await getAssistantDb()
    .update(githubConnections)
    .set({ lastUsedAt: new Date(), updatedAt: new Date() })
    .where(
      connectionIdNamespaceWhere({
        connectionId: row.id,
        namespace: row.namespace,
      })
    );
  return token;
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
  const connection = await getGithubConnectionForNamespace(namespace);
  if (connection == null) {
    throw new Error("GitHub App is not installed for this namespace.");
  }
  const token = await getGithubInstallationToken({
    connectionId: connection.id,
    namespace,
  });
  if (token == null) {
    throw new Error("GitHub App connection is not authorized.");
  }

  const out: GithubRepoDTO[] = [];
  const perPage = 100;
  for (let page = 1; page <= 5; page += 1) {
    const url = new URL("/installation/repositories", GITHUB_API);
    url.searchParams.set("page", String(page));
    url.searchParams.set("per_page", String(perPage));
    const res = await fetch(url.toString(), {
      cache: "no-store",
      headers: githubInstallationHeaders(token),
    });
    if (!res.ok) {
      throw new Error(
        `GitHub installation repositories request failed with status ${res.status}.`
      );
    }
    const payload = (await res.json()) as GithubInstallationRepoResponse;
    const repos = Array.isArray(payload.repositories)
      ? payload.repositories.flatMap((row) => {
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
