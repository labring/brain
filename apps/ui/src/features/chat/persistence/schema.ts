import type { UIMessage } from "ai";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { CURRENT_GITHUB_OWNER_IDENTITY_VERSION } from "../../deploy/github/owner-identity";
import { ASSISTANT_DB_SCHEMA } from "./types";

/**
 * Isolated from `public` so `drizzle-kit push` with `schemaFilter` does not try
 * to drop operator/managed tables (e.g. `postgres_log`, extension views).
 */
export const ns = pgSchema(ASSISTANT_DB_SCHEMA);

/** Personal Assistant Conversation owned by a verified Workspace Actor (ADR 0056). */
export const assistantChats = ns.table(
  "assistant_chats",
  {
    id: text("id").primaryKey(),
    /** Logical namespace bucket (UI: `namespaceAtom`); empty namespaces map to the default bucket at write time. */
    namespace: text("namespace").notNull(),
    /**
     * The owner's global `userUid` (ADR-0059). Set at creation and immutable;
     * legacy beta rows carry the per-region crName until lazily adopted.
     */
    workspaceActor: text("workspace_actor").notNull(),
    /** Shown in thread picker; placeholders use `chat-YYYY-MM-DD` until renamed by AI after the first turn. */
    title: text("title").notNull().default("Chat"),
    /** Once `true`, placeholder/heuristic title generation is skipped. */
    titleAiGenerated: boolean("title_ai_generated").notNull().default(false),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("assistant_chats_updated_at_idx").on(table.updatedAt),
    index("assistant_chats_namespace_actor_updated_at_idx").on(
      table.namespace,
      table.workspaceActor,
      table.updatedAt
    ),
  ]
);

/** Persisted AI SDK `{ id, role, parts }` messages (parts stored as JSONB). */
export const assistantChatMessages = ns.table(
  "assistant_chat_messages",
  {
    id: text("id").primaryKey(),
    chatId: text("chat_id")
      .notNull()
      .references(() => assistantChats.id, { onDelete: "cascade" }),
    role: text("role").notNull().$type<UIMessage["role"]>(),
    parts: jsonb("parts").notNull().$type<UIMessage["parts"]>(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("assistant_chat_messages_chat_id_idx").on(table.chatId),
    index("assistant_chat_messages_chat_id_created_idx").on(
      table.chatId,
      table.createdAt
    ),
  ]
);

/**
 * Per-namespace free chat turns (system OpenAI token). Key matches
 * {@link resolveAuthoritativeChatNamespace} / `assistant_chats.namespace`.
 */
export const assistantEntitlements = ns.table(
  "assistant_entitlements",
  {
    namespace: text("namespace").primaryKey(),
    freeTurnsUsed: integer("free_turns_used").notNull().default(0),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("assistant_entitlements_updated_at_idx").on(table.updatedAt),
  ]
);

/** Brain-owned lifecycle ledger for shared assistant Devbox runtimes. */
export const assistantDevboxRuntimes = ns.table(
  "assistant_devbox_runtimes",
  {
    upstreamId: text("upstream_id").primaryKey(),
    namespace: text("namespace").notNull(),
    /** Verified global user UID that last used this runtime (ADR-0059). */
    workspaceActor: text("workspace_actor").notNull().default(""),
    runtimeName: text("runtime_name").notNull(),
    pauseDueAt: timestamp("pause_due_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    pausedAt: timestamp("paused_at", { mode: "date", withTimezone: true }),
    deleteDueAt: timestamp("delete_due_at", {
      mode: "date",
      withTimezone: true,
    }),
    cleanupLeaseOwner: text("cleanup_lease_owner"),
    cleanupLeaseExpiresAt: timestamp("cleanup_lease_expires_at", {
      mode: "date",
      withTimezone: true,
    }),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("assistant_devbox_runtimes_pause_due_idx")
      .on(table.pauseDueAt)
      .where(sql`${table.pausedAt} IS NULL`),
    index("assistant_devbox_runtimes_delete_due_idx")
      .on(table.deleteDueAt)
      .where(sql`${table.deleteDueAt} IS NOT NULL`),
    index("assistant_devbox_runtimes_workspace_actor_idx").on(
      table.workspaceActor
    ),
  ]
);

export const githubConnections = ns.table(
  "github_connections",
  {
    id: text("id").primaryKey(),
    namespace: text("namespace").notNull(),
    type: text("type").notNull().default("github_app"),
    installationId: text("installation_id").notNull(),
    accountLogin: text("account_login").notNull(),
    accountType: text("account_type").notNull().default("User"),
    repositorySelection: text("repository_selection").notNull().default("all"),
    installedByUserId: text("installed_by_user_id").notNull(),
    revokedAt: timestamp("revoked_at", { mode: "date", withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", {
      mode: "date",
      withTimezone: true,
    }),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("github_connections_updated_at_idx").on(table.updatedAt),
    index("github_connections_namespace_updated_at_idx").on(
      table.namespace,
      table.updatedAt
    ),
    uniqueIndex("github_connections_namespace_unique_idx").on(table.namespace),
    index("github_connections_installation_idx").on(table.installationId),
  ]
);

/**
 * Region-local Identity Fingerprints (ADR-0059), owned by the authorization
 * layer (`@/lib/identity-fingerprint`): the most recently observed
 * `crName → userUid` binding and that token's minting time. An observation
 * history, not an authoritative mapping — authority stays with desktop's
 * token minting. A newer-minted contradiction re-keys the tombstone uid's
 * personal resources to the surviving uid; an older-minted one marks a
 * superseded token, refused at the authorization layer. Rows never appear in
 * API responses; identifiers only in logs/telemetry.
 */
export const identityFingerprints = ns.table("identity_fingerprints", {
  /** The per-region user CR name authenticated from the kubeconfig. */
  crName: text("cr_name").primaryKey(),
  /** The most recently observed global account uid bound to this crName. */
  userUid: text("user_uid").notNull(),
  /** That observation's app-token minting time (JWT `iat`, epoch seconds). */
  mintedAt: bigint("minted_at", { mode: "number" }).notNull(),
  observedAt: timestamp("observed_at", { mode: "date", withTimezone: true })
    .defaultNow()
    .notNull(),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
    .defaultNow()
    .notNull(),
});

/** Durable redirects from merged account UIDs to their current survivor. */
export const identityUidCanonicalizations = ns.table(
  "identity_uid_canonicalizations",
  {
    userUid: text("user_uid").primaryKey(),
    canonicalUserUid: text("canonical_user_uid").notNull(),
  },
  (table) => [
    index("identity_uid_canonicalizations_canonical_idx").on(
      table.canonicalUserUid
    ),
  ]
);

export const githubAppInstallSessions = ns.table(
  "github_app_install_sessions",
  {
    state: text("state").primaryKey(),
    namespace: text("namespace").notNull(),
    workspaceActor: text("workspace_actor").notNull().default(""),
    ownerIdentityVersion: integer("owner_identity_version")
      .notNull()
      .default(0),
    returnPath: text("return_path"),
    expiresAt: timestamp("expires_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("github_app_install_sessions_expires_at_idx").on(table.expiresAt),
    index("github_app_install_sessions_namespace_idx").on(table.namespace),
  ]
);

export const githubOauthConnections = ns.table(
  "github_oauth_connections",
  {
    id: text("id").primaryKey(),
    namespace: text("namespace").notNull(),
    workspaceActor: text("workspace_actor").notNull().default(""),
    ownerIdentityVersion: integer("owner_identity_version")
      .notNull()
      .default(0),
    revokingAt: timestamp("revoking_at", {
      mode: "date",
      withTimezone: true,
    }),
    /** UID whose runtime credentials must be cleared before final deletion. */
    revocationWorkspaceActor: text("revocation_workspace_actor"),
    githubLogin: text("github_login").notNull(),
    accessTokenCiphertext: text("access_token_ciphertext").notNull(),
    tokenType: text("token_type").notNull().default("bearer"),
    scope: text("scope").notNull().default(""),
    lastUsedAt: timestamp("last_used_at", {
      mode: "date",
      withTimezone: true,
    }),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("github_oauth_connections_updated_at_idx").on(table.updatedAt),
    index("github_oauth_connections_github_login_idx").on(table.githubLogin),
    uniqueIndex("github_oauth_connections_current_owner_unique_idx")
      .on(table.namespace, table.workspaceActor)
      .where(
        sql`${table.ownerIdentityVersion} = ${sql.raw(String(CURRENT_GITHUB_OWNER_IDENTITY_VERSION))} AND ${table.revokingAt} IS NULL`
      ),
  ]
);

export type AssistantChatRow = typeof assistantChats.$inferSelect;
export type AssistantChatMessageRow = typeof assistantChatMessages.$inferSelect;
export type AssistantEntitlementRow = typeof assistantEntitlements.$inferSelect;
export type AssistantDevboxRuntimeRow =
  typeof assistantDevboxRuntimes.$inferSelect;
export type IdentityFingerprintRow = typeof identityFingerprints.$inferSelect;
export type GithubAppInstallSessionRow =
  typeof githubAppInstallSessions.$inferSelect;
export type GithubConnectionRow = typeof githubConnections.$inferSelect;
export type GithubOauthConnectionRow =
  typeof githubOauthConnections.$inferSelect;
