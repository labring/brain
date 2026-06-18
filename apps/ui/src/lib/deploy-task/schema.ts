import type { UIMessage } from "ai";
import {
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import type {
  TemplateDefaultValue,
  TemplateSourceInput,
} from "@/lib/template-provider-core";
import type { DeploymentTaskTimelineSnapshot } from "./timeline";

export const DEPLOYMENT_TASK_DB_SCHEMA = "sealai_deployment";

export const ns = pgSchema(DEPLOYMENT_TASK_DB_SCHEMA);

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

export type DeploymentTaskCreatedFrom = "api" | "automation" | "chat" | "ui";

export interface DeployTaskArtifactSummary {
  appliedResources?: unknown[];
  artifacts?: unknown[];
  buildResult?: unknown;
  deliveryManifest?: unknown;
  deploymentPlan?: DeploymentTaskDeploymentPlan;
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

export interface DeploymentTaskDeploymentPlanInput extends TemplateSourceInput {
  sensitive?: boolean;
}

export interface DeploymentTaskDeploymentPlan {
  args?: Record<string, string>;
  defaults?: Record<string, TemplateDefaultValue>;
  inputs: DeploymentTaskDeploymentPlanInput[];
  kind: "sealos-template";
  missingInputKeys?: string[];
  templateName: string;
}

export interface DeploymentTaskCanvasProjectionExpectedRef {
  kind: "AP" | "DB" | "PublicAccess" | "TemplateNative";
  name: string;
  namespace: string;
}

export interface DeploymentTaskCanvasProjectionSlot {
  anchor?: boolean;
  expectedRef?: DeploymentTaskCanvasProjectionExpectedRef;
  id: string;
}

export interface DeploymentTaskCanvasProjectionEdge {
  evidence?: string;
  id?: string;
  sourceSlotId: string;
  targetSlotId: string;
}

export interface DeploymentTaskCanvasProjectionResultMapping {
  actualRef: DeploymentTaskCanvasProjectionExpectedRef;
  slotId: string;
}

export interface DeploymentTaskCanvasProjection {
  edges?: DeploymentTaskCanvasProjectionEdge[];
  resultMappings?: DeploymentTaskCanvasProjectionResultMapping[];
  slots?: DeploymentTaskCanvasProjectionSlot[];
}

export interface DeployTaskBlockingInput {
  defaultValue?: string;
  description?: string;
  id: string;
  key?: string;
  label: string;
  options?: string[];
  required: boolean;
  sensitive?: boolean;
  type: "confirmation" | "env" | "secret" | "text";
  valueType?: string;
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
      description?: string;
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
    createdFrom: text("created_from")
      .notNull()
      .$type<DeploymentTaskCreatedFrom>()
      .default("api"),
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
    canvasProjection: jsonb("canvas_projection")
      .notNull()
      .$type<DeploymentTaskCanvasProjection>()
      .default({}),
    timelineSnapshot: jsonb(
      "timeline_snapshot"
    ).$type<DeploymentTaskTimelineSnapshot | null>(),
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

export type DeployTaskRow = typeof deployTasks.$inferSelect;
export type DeployTaskEventRow = typeof deployTaskEvents.$inferSelect;
export type DeployTaskMessageRow = typeof deployTaskMessages.$inferSelect;
