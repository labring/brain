import "server-only";

import { generateId } from "ai";
import {
  and,
  eq,
  isNotNull,
  isNull,
  lte,
  or,
  type SQL,
  sql,
} from "drizzle-orm";

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
import { requireCurrentIdentityBinding } from "@/lib/identity-fingerprint-core";

import {
  type GithubOAuthTokenResponse,
  githubUserTokenHeaders,
} from "./app-auth";
import {
  CURRENT_GITHUB_OWNER_IDENTITY_VERSION,
  type GithubConnectionOwnerIdentity,
  LEGACY_GITHUB_OWNER_IDENTITY_VERSION,
  type VerifiedGithubConnectionActor,
} from "./owner-identity";
import {
  decryptGithubUserToken,
  encryptGithubUserToken,
} from "./user-token-crypto";

const GITHUB_API = "https://api.github.com";

export interface GithubConnectionRevocationFence {
  namespace: string;
  revokingAt: Date;
  workspaceUserUid: string;
}

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
      revocationWorkspaceActor: null,
      revokingAt: null,
      scope: input.token.scope,
      tokenType: input.token.tokenType,
      updatedAt: now,
      workspaceActor: userUid,
    })
    .onConflictDoUpdate({
      set: {
        accessTokenCiphertext: encryptGithubUserToken(input.token.accessToken),
        githubLogin,
        revocationWorkspaceActor: null,
        scope: input.token.scope,
        tokenType: input.token.tokenType,
        revokingAt: null,
        updatedAt: now,
      },
      target: [
        githubOauthConnections.namespace,
        githubOauthConnections.workspaceActor,
      ],
      targetWhere: sql`${githubOauthConnections.ownerIdentityVersion} = ${sql.raw(String(CURRENT_GITHUB_OWNER_IDENTITY_VERSION))} AND ${githubOauthConnections.revokingAt} IS NULL`,
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

/**
 * Disconnect forgets the actor's connection across both generations
 * (ADR-0057): the uid-keyed row and any inert legacy crName row. Deleting
 * only the current owner would let a later entry request adopt the legacy
 * row and revive an authorization the user asked to forget.
 */
export async function revokeGithubConnectionsForActor(
  actor: VerifiedGithubConnectionActor,
  fence?: GithubConnectionRevocationFence
): Promise<void> {
  const { legacyWorkspaceActor, userUid } = requireVerifiedActor(actor);
  // Direct service callers fence on every explicit revoke. The HTTP handler
  // passes its fence through after runtime cleanup so a reauthorization
  // created during that cleanup remains active (revoking_at = NULL).
  const effectiveFence =
    fence ?? (await beginGithubConnectionRevocationForActor(actor));
  const namespace = normalizeAssistantNamespace(actor.owner.namespace);
  if (
    normalizeAssistantNamespace(effectiveFence.namespace) !== namespace ||
    effectiveFence.workspaceUserUid.trim() !== userUid
  ) {
    throw new Error("GitHub connection revocation fence does not match actor.");
  }
  await getAssistantDb()
    .delete(githubOauthConnections)
    .where(
      and(
        eq(
          githubOauthConnections.namespace,
          normalizeAssistantNamespace(actor.owner.namespace)
        ),
        or(
          and(
            eq(githubOauthConnections.workspaceActor, userUid),
            eq(
              githubOauthConnections.ownerIdentityVersion,
              actor.owner.ownerIdentityVersion
            )
          ),
          legacyConnectionOf(legacyWorkspaceActor)
        ),
        // Only delete rows fenced by beginGithubConnectionRevocationForActor.
        // A new authorization created while cleanup was in flight remains active.
        isNotNull(githubOauthConnections.revokingAt),
        eq(githubOauthConnections.revocationWorkspaceActor, userUid),
        lte(githubOauthConnections.revokingAt, effectiveFence.revokingAt)
      )
    );
}

/**
 * Durably fences all current and legacy credentials before runtime cleanup.
 * Reads and adoptions exclude fenced rows, while a concurrent reauthorization
 * can safely create a fresh active row because the unique index only covers
 * rows with revoking_at IS NULL.
 */
export async function beginGithubConnectionRevocationForActor(
  actor: VerifiedGithubConnectionActor
): Promise<GithubConnectionRevocationFence> {
  const { legacyWorkspaceActor, userUid } = requireVerifiedActor(actor);
  const namespace = normalizeAssistantNamespace(actor.owner.namespace);
  const now = new Date();
  await getAssistantDb()
    .update(githubOauthConnections)
    .set({
      revocationWorkspaceActor: userUid,
      revokingAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(githubOauthConnections.namespace, namespace),
        or(
          and(
            eq(githubOauthConnections.workspaceActor, userUid),
            eq(
              githubOauthConnections.ownerIdentityVersion,
              actor.owner.ownerIdentityVersion
            )
          ),
          legacyConnectionOf(legacyWorkspaceActor)
        ),
        isNull(githubOauthConnections.revokingAt)
      )
    );
  return { namespace, revokingAt: now, workspaceUserUid: userUid };
}

/** Finalizes only rows fenced for this namespace/UID; active reauth survives. */
export async function finalizeGithubConnectionRevocation(input: {
  namespace: string;
  workspaceUserUid: string;
}): Promise<void> {
  await getAssistantDb()
    .delete(githubOauthConnections)
    .where(
      and(
        eq(
          githubOauthConnections.namespace,
          normalizeAssistantNamespace(input.namespace)
        ),
        eq(
          githubOauthConnections.revocationWorkspaceActor,
          input.workspaceUserUid.trim()
        ),
        isNotNull(githubOauthConnections.revokingAt)
      )
    );
}

const CURRENT_OWNER_UNIQUE_INDEX =
  "github_oauth_connections_current_owner_unique_idx";

/**
 * Matches only conflicts on the current-owner unique index — via the
 * driver's `constraint` field or the Postgres error message — so unrelated
 * constraint violations still surface.
 */
function isCurrentOwnerUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current != null; depth += 1) {
    if (typeof current !== "object") {
      return false;
    }
    const record = current as {
      cause?: unknown;
      constraint?: unknown;
      message?: unknown;
    };
    if (
      record.constraint === CURRENT_OWNER_UNIQUE_INDEX ||
      (typeof record.message === "string" &&
        record.message.includes(CURRENT_OWNER_UNIQUE_INDEX))
    ) {
      return true;
    }
    current = record.cause;
  }
  return false;
}

function legacyConnectionOf(legacyWorkspaceActor: string) {
  return and(
    eq(githubOauthConnections.workspaceActor, legacyWorkspaceActor),
    eq(
      githubOauthConnections.ownerIdentityVersion,
      LEGACY_GITHUB_OWNER_IDENTITY_VERSION
    )
  );
}

function requireVerifiedActor(actor: VerifiedGithubConnectionActor): {
  legacyWorkspaceActor: string;
  userUid: string;
} {
  const legacyWorkspaceActor = actor.legacyWorkspaceActor.trim();
  const userUid = actor.owner.userUid.trim();
  if (
    legacyWorkspaceActor === "" ||
    userUid === "" ||
    actor.owner.ownerIdentityVersion !== CURRENT_GITHUB_OWNER_IDENTITY_VERSION
  ) {
    throw new Error("Current GitHub connection owner identity is required.");
  }
  return { legacyWorkspaceActor, userUid };
}

/**
 * Lazy re-key (ADR-0059): re-keys the verified actor's legacy generation-1
 * crName row to the proven uid and upgrades it to the current generation in
 * one idempotent UPDATE. A unique-index conflict means the user already
 * reauthorized under the uid — the new authorization wins and the legacy row
 * stays inert (invisible to uid-keyed reads).
 */
export async function adoptLegacyGithubConnectionForOwner(
  actor: VerifiedGithubConnectionActor
): Promise<void> {
  const { legacyWorkspaceActor, userUid } = requireVerifiedActor(actor);
  try {
    await getAssistantDb().transaction(async (tx) => {
      // Adoption keys the legacy row to this uid, so it must not run after
      // a merge tombstoned it — the survivor could never adopt it back.
      await requireCurrentIdentityBinding(tx, {
        crName: legacyWorkspaceActor,
        userUid,
      });
      await tx
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
              normalizeAssistantNamespace(actor.owner.namespace)
            ),
            legacyConnectionOf(legacyWorkspaceActor),
            isNull(githubOauthConnections.revokingAt)
          )
        );
    });
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
    eq(githubOauthConnections.ownerIdentityVersion, owner.ownerIdentityVersion),
    isNull(githubOauthConnections.revokingAt)
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
    .where(
      and(
        eq(githubOauthConnections.id, row.id),
        isNull(githubOauthConnections.revokingAt)
      )
    );
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
