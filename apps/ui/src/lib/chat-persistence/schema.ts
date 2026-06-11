import type { UIMessage } from "ai";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { ASSISTANT_DB_SCHEMA } from "./types";

/**
 * Isolated from `public` so `drizzle-kit push` with `schemaFilter` does not try
 * to drop operator/managed tables (e.g. `postgres_log`, extension views).
 */
export const ns = pgSchema(ASSISTANT_DB_SCHEMA);

/**
 * Conversation thread scoped by `namespace` (e.g. K8s namespace) so assistants
 * in different workspaces do not share history unless intended.
 */
export const assistantChats = ns.table(
  "assistant_chats",
  {
    id: text("id").primaryKey(),
    /** Logical owner key (UI: `namespaceAtom`); empty namespaces map to the default bucket at write time. */
    namespace: text("namespace").notNull(),
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
    index("assistant_chats_namespace_updated_at_idx").on(
      table.namespace,
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

export interface EncryptedSecretPayload {
  ciphertext: string;
  iv: string;
  tag: string;
  version: 1;
}

export const githubConnections = ns.table(
  "github_connections",
  {
    namespace: text("namespace").primaryKey(),
    githubLogin: text("github_login").notNull(),
    scope: text("scope").notNull().default(""),
    tokenType: text("token_type").notNull().default("bearer"),
    encryptedAccessToken: jsonb("encrypted_access_token")
      .notNull()
      .$type<EncryptedSecretPayload>(),
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
    index("github_connections_github_login_idx").on(table.githubLogin),
  ]
);

export type AssistantChatRow = typeof assistantChats.$inferSelect;
export type AssistantChatMessageRow = typeof assistantChatMessages.$inferSelect;
export type AssistantEntitlementRow = typeof assistantEntitlements.$inferSelect;
export type GithubConnectionRow = typeof githubConnections.$inferSelect;
