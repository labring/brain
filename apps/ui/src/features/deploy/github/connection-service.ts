import "server-only";

import { generateId } from "ai";
import { and, eq, type SQL, sql } from "drizzle-orm";

import {
  type AssistantPgTransaction,
  getAssistantDb,
} from "@/features/chat/persistence/db";
import {
  type GithubConnectionRow,
  type GithubOauthConnectionRow,
  githubConnections,
  githubOauthConnections,
} from "@/features/chat/persistence/schema";
import { normalizeAssistantNamespace } from "@/features/chat/persistence/types";

import {
  type GithubOAuthTokenResponse,
  githubUserTokenHeaders,
} from "./app-auth";
import {
  CURRENT_GITHUB_OWNER_IDENTITY_VERSION,
  type GithubConnectionOwnerIdentity,
  LEGACY_GITHUB_OWNER_IDENTITY_VERSION,
} from "./owner-identity";
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

interface GithubOauthConnectionInput {
  githubLogin: string;
  owner: GithubConnectionOwnerIdentity;
  token: GithubOAuthTokenResponse;
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
  installationId: string;
  namespace: string;
  repositorySelection?: string;
  workspaceActor: string;
}): Promise<GithubConnectionDTO> {
  const namespace = normalizeAssistantNamespace(input.namespace);
  const workspaceActor = input.workspaceActor.trim();
  const installationId = input.installationId.trim();
  if (workspaceActor === "") {
    throw new Error("GitHub App connection Workspace Actor is required.");
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
      installedByUserId: workspaceActor,
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
        installedByUserId: workspaceActor,
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

export async function upsertGithubOauthConnectionInTransaction(
  transaction: AssistantPgTransaction,
  input: GithubOauthConnectionInput
): Promise<GithubConnectionDTO> {
  const namespace = normalizeAssistantNamespace(input.owner.namespace);
  const userUid = input.owner.userUid.trim();
  const githubLogin = input.githubLogin.trim();
  if (
    userUid === "" ||
    input.owner.ownerIdentityVersion !== CURRENT_GITHUB_OWNER_IDENTITY_VERSION
  ) {
    throw new Error("Current GitHub connection owner identity is required.");
  }
  if (githubLogin === "") {
    throw new Error("GitHub OAuth connection login is required.");
  }

  const now = new Date();
  const [row] = await transaction
    .insert(githubOauthConnections)
    .values({
      accessTokenCiphertext: encryptGithubUserToken(input.token.accessToken),
      githubLogin,
      id: generateId(),
      namespace,
      ownerIdentityVersion: input.owner.ownerIdentityVersion,
      scope: input.token.scope,
      tokenType: input.token.tokenType,
      updatedAt: now,
      workspaceActor: userUid,
    })
    .onConflictDoUpdate({
      set: {
        accessTokenCiphertext: encryptGithubUserToken(input.token.accessToken),
        githubLogin,
        scope: input.token.scope,
        tokenType: input.token.tokenType,
        updatedAt: now,
      },
      target: [
        githubOauthConnections.namespace,
        githubOauthConnections.workspaceActor,
      ],
      targetWhere: sql`${githubOauthConnections.ownerIdentityVersion} = ${sql.raw(String(CURRENT_GITHUB_OWNER_IDENTITY_VERSION))}`,
    })
    .returning();
  if (row == null) {
    throw new Error("Failed to store GitHub OAuth connection.");
  }
  return toOauthConnectionDTO(row);
}

export async function getGithubConnectionStatusForOwner(
  input: GithubConnectionOwnerIdentity
): Promise<GithubConnectionDTO | null> {
  const [row] = await getAssistantDb()
    .select()
    .from(githubOauthConnections)
    .where(githubOauthOwnerWhere(input))
    .limit(1);
  return row == null ? null : toOauthConnectionDTO(row);
}

export async function revokeGithubConnectionForOwner(
  input: GithubConnectionOwnerIdentity
): Promise<void> {
  await getAssistantDb()
    .delete(githubOauthConnections)
    .where(githubOauthOwnerWhere(input));
}

const CURRENT_OWNER_UNIQUE_INDEX =
  "github_oauth_connections_current_owner_unique_idx";

function isCurrentOwnerUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current != null; depth += 1) {
    if (typeof current !== "object") {
      return false;
    }
    const record = current as {
      cause?: unknown;
      code?: unknown;
      message?: unknown;
    };
    if (
      record.code === "23505" ||
      (typeof record.message === "string" &&
        record.message.includes(CURRENT_OWNER_UNIQUE_INDEX))
    ) {
      return true;
    }
    current = record.cause;
  }
  return false;
}

/**
 * Lazy re-key (ADR-0059): re-keys the verified actor's legacy generation-1
 * crName row to the proven uid and upgrades it to the current generation in
 * one idempotent UPDATE. A unique-index conflict means the user already
 * reauthorized under the uid — the new authorization wins and the legacy row
 * stays inert (invisible to uid-keyed reads).
 */
export async function adoptLegacyGithubConnectionForOwner(input: {
  legacyWorkspaceActor: string;
  owner: GithubConnectionOwnerIdentity;
}): Promise<void> {
  const legacyWorkspaceActor = input.legacyWorkspaceActor.trim();
  const userUid = input.owner.userUid.trim();
  if (
    legacyWorkspaceActor === "" ||
    userUid === "" ||
    input.owner.ownerIdentityVersion !== CURRENT_GITHUB_OWNER_IDENTITY_VERSION
  ) {
    throw new Error("Current GitHub connection owner identity is required.");
  }
  try {
    await getAssistantDb()
      .update(githubOauthConnections)
      .set({
        ownerIdentityVersion: CURRENT_GITHUB_OWNER_IDENTITY_VERSION,
        updatedAt: new Date(),
        workspaceActor: userUid,
      })
      .where(
        and(
          eq(
            githubOauthConnections.namespace,
            normalizeAssistantNamespace(input.owner.namespace)
          ),
          eq(githubOauthConnections.workspaceActor, legacyWorkspaceActor),
          eq(
            githubOauthConnections.ownerIdentityVersion,
            LEGACY_GITHUB_OWNER_IDENTITY_VERSION
          )
        )
      );
  } catch (error) {
    if (!isCurrentOwnerUniqueViolation(error)) {
      throw error;
    }
  }
}

export function getGithubOAuthTokenForOwner(
  input: GithubConnectionOwnerIdentity
): Promise<string | null> {
  return materializeGithubOAuthToken(githubOauthOwnerWhere(input));
}

export function getGithubOAuthTokenForDeploymentBinding(input: {
  connectionRef: string;
  credentialOwner: string;
  namespace: string;
  ownerIdentityVersion: number;
}): Promise<string | null> {
  const owner = {
    namespace: input.namespace,
    ownerIdentityVersion: input.ownerIdentityVersion,
    userUid: input.credentialOwner,
  } satisfies GithubConnectionOwnerIdentity;
  return materializeGithubOAuthToken(
    and(
      eq(githubOauthConnections.id, input.connectionRef.trim()),
      githubOauthOwnerWhere(owner)
    )
  );
}

function githubOauthOwnerWhere(owner: GithubConnectionOwnerIdentity) {
  return and(
    eq(
      githubOauthConnections.namespace,
      normalizeAssistantNamespace(owner.namespace)
    ),
    eq(githubOauthConnections.workspaceActor, owner.userUid.trim()),
    eq(githubOauthConnections.ownerIdentityVersion, owner.ownerIdentityVersion)
  );
}

async function materializeGithubOAuthToken(
  where: SQL | undefined
): Promise<string | null> {
  const [row] = await getAssistantDb()
    .select()
    .from(githubOauthConnections)
    .where(where)
    .limit(1);
  if (row == null) {
    return null;
  }
  const now = new Date();
  await getAssistantDb()
    .update(githubOauthConnections)
    .set({ lastUsedAt: now, updatedAt: now })
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

async function listGithubReposWithToken(
  token: string
): Promise<GithubRepoDTO[]> {
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

export async function listGithubReposForOwner(
  owner: GithubConnectionOwnerIdentity
): Promise<GithubRepoDTO[]> {
  const token = await getGithubOAuthTokenForOwner(owner);
  if (token == null) {
    throw new Error("GitHub OAuth connection is not authorized.");
  }

  return listGithubReposWithToken(token);
}
