import type { UIMessage } from "ai";
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

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
    /** Verified `user-system` ServiceAccount name. Set at creation and immutable. */
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
      .where(sql`${table.ownerIdentityVersion} = 1`),
  ]
);

export type AssistantChatRow = typeof assistantChats.$inferSelect;
export type AssistantChatMessageRow = typeof assistantChatMessages.$inferSelect;
export type AssistantEntitlementRow = typeof assistantEntitlements.$inferSelect;
export type GithubAppInstallSessionRow =
  typeof githubAppInstallSessions.$inferSelect;
export type GithubConnectionRow = typeof githubConnections.$inferSelect;
export type GithubOauthConnectionRow =
  typeof githubOauthConnections.$inferSelect;
