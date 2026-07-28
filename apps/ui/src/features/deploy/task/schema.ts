import type { UIMessage } from "ai";
import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import type {
  TemplateDefaultValue,
  TemplateSourceInput,
} from "@/features/deploy/template-provider-core";
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

export const CURRENT_DEPLOYMENT_CREDENTIAL_BINDING_VERSION = 1;
export const CURRENT_AI_ARTIFACT_PUBLIC_PROJECTION_VERSION = 1;
/** @deprecated AI-generated blocker metadata never grants projection trust. */
export const CURRENT_AI_BLOCKING_INPUT_PUBLIC_PROJECTION_VERSION = 1;
export const CURRENT_AI_TIMELINE_PUBLIC_PROJECTION_VERSION = 1;

/**
 * Immutable credential selection written with a GitHub Deployment Task.
 * The reference is resolved only together with its verified owner.
 */
export interface DeploymentCredentialBinding {
  connectionRef: string;
  credentialOwner: string;
  version: number;
}

/**
 * Result identities allocated by a run (e.g. the random-suffixed template
 * instance name), recorded first-class at allocation time — before any
 * external apply uses them — and copied onto redeploy clones so recovery
 * converges on the same preserved resources (ADR 0038).
 */
export interface DeployTaskResultIdentities {
  templateInstanceName?: string;
}

export interface DeployTaskArtifactSummary {
  appliedResources?: unknown[];
  artifacts?: unknown[];
  buildResult?: unknown;
  deliveryManifest?: unknown;
  deploymentPlan?: DeploymentTaskDeploymentPlan;
  entrypointYaml?: string;
  notes?: string;
  outputJson?: unknown;
  /** Server stamp proving rich AI artifact fields were scrubbed. */
  publicProjectionVersion?: number;
  resources?: {
    apiVersion: string;
    kind: string;
    name: string;
    namespace: string;
  }[];
  resourceYamls?: string[];
  resultIdentities?: DeployTaskResultIdentities;
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
  kind: "AP" | "DB" | "PublicAccess";
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
  /** @deprecated Retained only for rows written before fail-closed projection. */
  publicProjectionVersion?: number;
  required: boolean;
  sensitive?: boolean;
  type: "confirmation" | "env" | "secret" | "text";
  valueType?: string;
}

export interface DeployTaskEventPayload {
  [key: string]: unknown;
}

export type DeployTaskFailureReason =
  | "github-authentication"
  | "repository-clone-failed"
  | "ai-proxy-unavailable"
  | "deploy-runtime-unavailable"
  | "build-runtime-unavailable"
  | "deploy-skill-install-failed"
  | "buildkit-start-failed"
  | "image-build-failed"
  | "gateway-not-exposed"
  | "gateway-unavailable"
  | "gateway-upstream-error"
  | "gateway-timeout"
  | "deployment-output-missing"
  | "apply-failed"
  | "quota-exceeded"
  | "readiness-timeout"
  | "interrupted"
  | "timeout"
  | "never-started"
  | "runner-error"
  | "cancelled"
  | "unknown";

export type DeployTaskFailureStage = "apply" | "readiness";

export interface DeployTaskFailureDetails extends Record<string, unknown> {
  failureMessage?: string;
  httpStatus?: number;
  reason?: DeployTaskFailureReason;
  stage?: DeployTaskFailureStage;
}
export type DeployTaskGatewayStateSnapshot = Record<string, unknown>;

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
  /**
   * Client-declared sensitive arg keys (names only — never values). The
   * engine strips these from `args` before the row is written (ADR 0037);
   * the name list itself is persisted so clones know what must be re-asked.
   */
  sensitiveKeys?: string[];
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
      /**
       * Omit to let the server derive the name from the Deployment Source and
       * resolve collisions with a suffix; supply one to have it used verbatim,
       * with a collision reported as a conflict rather than renamed (ADR 0058).
       */
      displayName?: string;
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
    creatingActor: text("creating_actor"),
    credentialBinding: jsonb(
      "credential_binding"
    ).$type<DeploymentCredentialBinding | null>(),
    /** Compatibility-only Desktop identity. Never use this field for authorization. */
    actorUserId: text("actor_user_id"),
    /** Compatibility-only client selector. Never use this field for credential lookup. */
    githubConnectionId: text("github_connection_id"),
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
    gatewayStateSnapshot: jsonb(
      "gateway_state_snapshot"
    ).$type<DeployTaskGatewayStateSnapshot | null>(),
    failureDetails: jsonb(
      "failure_details"
    ).$type<DeployTaskFailureDetails | null>(),
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
    cancelRequestedAt: timestamp("cancel_requested_at", {
      mode: "date",
      withTimezone: true,
    }),
    leaseOwner: text("lease_owner"),
    leaseEpoch: bigint("lease_epoch", { mode: "number" }).notNull().default(0),
    leaseClaimedAt: timestamp("lease_claimed_at", {
      mode: "date",
      withTimezone: true,
    }),
    leaseExpiresAt: timestamp("lease_expires_at", {
      mode: "date",
      withTimezone: true,
    }),
    retriedFromTaskId: text("retried_from_task_id"),
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
    // Reaper scans (ADR 0037): leased statuses by lease expiry, queued by
    // age, terminal by completion time.
    index("deploy_tasks_leased_expiry_idx")
      .on(table.leaseExpiresAt)
      .where(sql`${table.status} IN ('running', 'applying')`),
    index("deploy_tasks_queued_created_idx")
      .on(table.createdAt)
      .where(sql`${table.status} = 'queued'`),
    index("deploy_tasks_terminal_completed_idx")
      .on(table.completedAt)
      .where(sql`${table.status} IN ('completed', 'failed', 'cancelled')`),
    // One active clone per predecessor (ADR 0038): a concurrent redeploy
    // loses this insert and surfaces as a conflict. Keyed by namespace so a
    // stray cross-namespace row (predecessor lookups are namespace-scoped,
    // so only legacy or hand-inserted data) can never block a legitimate
    // redeploy with a conflict the caller can neither see nor resolve.
    uniqueIndex("deploy_tasks_one_active_clone_idx")
      .on(table.namespace, table.retriedFromTaskId)
      .where(
        sql`${table.retriedFromTaskId} IS NOT NULL AND ${table.status} IN ('queued', 'running', 'blocked', 'applying')`
      ),
  ]
);

/**
 * Global sequence backing `deploy_task_events.seq`, so event inserts are
 * single-statement and lock-free (ADR 0037). Per-task ordering only needs
 * monotonicity, not density.
 */
export const deployTaskEventsSeq = ns.sequence("deploy_task_events_seq", {
  startWith: 1,
});

export const deployTaskEvents = ns.table(
  "deploy_task_events",
  {
    taskId: text("task_id")
      .notNull()
      .references(() => deployTasks.id, { onDelete: "cascade" }),
    seq: bigint("seq", { mode: "number" })
      .notNull()
      .default(
        sql`nextval('sealai_deployment.deploy_task_events_seq'::regclass)`
      ),
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
