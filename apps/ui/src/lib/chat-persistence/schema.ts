import type { UIMessage } from "ai";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
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

export type DeployTaskStatus =
  | "queued"
  | "running"
  | "blocked"
  | "applying"
  | "completed"
  | "failed"
  | "cancelled";

export type DeployTaskPhase =
  | "queued"
  | "resolve-target"
  | "prepare"
  | "plan"
  | "configure"
  | "generate-artifacts"
  | "apply"
  | "verify"
  | "completed";

export interface DeployTaskArtifactSummary {
  artifacts?: unknown[];
  entrypointYaml?: string;
  notes?: string;
  outputJson?: unknown;
  resources?: {
    apiVersion: string;
    kind: string;
    name: string;
    namespace: string;
  }[];
  resourceYamls?: string[];
}

export interface DeployTaskBlockingInput {
  id: string;
  label: string;
  required: boolean;
  type: "confirmation" | "env" | "secret" | "text";
}

export interface DeployTaskEventPayload {
  [key: string]: unknown;
}

export interface DeploymentTaskGithubSource {
  branch?: string;
  kind: "github";
  repo: {
    fullName: string;
    id?: string;
    name: string;
    url: string;
  };
}

export interface DeploymentTaskDockerSource {
  kind: "docker";
  settings: Record<string, unknown>;
}

export interface DeploymentTaskDatabaseSource {
  kind: "database";
  settings: Record<string, unknown>;
}

export interface DeploymentTaskTemplateSource {
  args?: Record<string, string>;
  kind: "template";
  templateName: string;
}

export interface DeploymentTaskPromptSource {
  kind: "prompt";
  text: string;
}

export type DeploymentTaskSource =
  | DeploymentTaskDatabaseSource
  | DeploymentTaskDockerSource
  | DeploymentTaskGithubSource
  | DeploymentTaskPromptSource
  | DeploymentTaskTemplateSource;

export type DeploymentTaskTarget =
  | {
      displayName: string;
      kind: "newProject";
    }
  | {
      kind: "existingProject";
      projectId: string;
      projectName?: string;
    };

export type DeploymentTaskRunner =
  | {
      kind: "direct";
    }
  | {
      kind: "template";
    }
  | {
      kind: "ai";
      runtimeProvider: "devbox";
      skill?: string;
    };

export const deployTasks = ns.table(
  "deploy_tasks",
  {
    id: text("id").primaryKey(),
    namespace: text("namespace").notNull(),
    // Storage migration boundary: the physical column remains `project_uid`;
    // the app-level contract is the Brain Project ID.
    projectId: text("project_uid"),
    projectName: text("project_name"),
    prompt: text("prompt"),
    source: jsonb("source").notNull().$type<DeploymentTaskSource>(),
    target: jsonb("target").notNull().$type<DeploymentTaskTarget>(),
    runner: jsonb("runner").notNull().$type<DeploymentTaskRunner>(),
    status: text("status").notNull().$type<DeployTaskStatus>(),
    phase: text("phase").notNull().$type<DeployTaskPhase>(),
    runtimeProvider: text("runtime_provider"),
    runtimeName: text("runtime_name"),
    runtimeState: text("runtime_state"),
    gatewayUrl: text("gateway_url"),
    gatewaySessionId: text("gateway_session_id"),
    gatewayThreadId: text("gateway_thread_id"),
    gatewayTurnId: text("gateway_turn_id"),
    artifactSummary: jsonb("artifact_summary")
      .notNull()
      .$type<DeployTaskArtifactSummary>()
      .default({}),
    blockingInputs: jsonb("blocking_inputs")
      .notNull()
      .$type<DeployTaskBlockingInput[]>()
      .default([]),
    previewUrl: text("preview_url"),
    resultUrl: text("result_url"),
    error: text("error"),
    heartbeatAt: timestamp("heartbeat_at", {
      mode: "date",
      withTimezone: true,
    }),
    startedAt: timestamp("started_at", { mode: "date", withTimezone: true }),
    completedAt: timestamp("completed_at", {
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
    index("deploy_tasks_namespace_updated_at_idx").on(
      table.namespace,
      table.updatedAt
    ),
    index("deploy_tasks_project_uid_updated_at_idx").on(
      table.projectId,
      table.updatedAt
    ),
    index("deploy_tasks_status_updated_at_idx").on(
      table.status,
      table.updatedAt
    ),
  ]
);

export const deployTaskEvents = ns.table(
  "deploy_task_events",
  {
    taskId: text("task_id")
      .notNull()
      .references(() => deployTasks.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    kind: text("kind").notNull(),
    phase: text("phase").$type<DeployTaskPhase>(),
    message: text("message"),
    payload: jsonb("payload")
      .notNull()
      .$type<DeployTaskEventPayload>()
      .default({}),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.taskId, table.seq],
      name: "deploy_task_events_pk",
    }),
    index("deploy_task_events_task_created_at_idx").on(
      table.taskId,
      table.createdAt
    ),
  ]
);

export const deployTaskMessages = ns.table(
  "deploy_task_messages",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => deployTasks.id, { onDelete: "cascade" }),
    role: text("role").notNull().$type<UIMessage["role"]>(),
    parts: jsonb("parts").notNull().$type<UIMessage["parts"]>(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("deploy_task_messages_task_id_idx").on(table.taskId),
    index("deploy_task_messages_task_created_idx").on(
      table.taskId,
      table.createdAt
    ),
  ]
);

export type AssistantChatRow = typeof assistantChats.$inferSelect;
export type AssistantChatMessageRow = typeof assistantChatMessages.$inferSelect;
export type AssistantEntitlementRow = typeof assistantEntitlements.$inferSelect;
export type GithubConnectionRow = typeof githubConnections.$inferSelect;
export type DeployTaskRow = typeof deployTasks.$inferSelect;
export type DeployTaskEventRow = typeof deployTaskEvents.$inferSelect;
export type DeployTaskMessageRow = typeof deployTaskMessages.$inferSelect;
