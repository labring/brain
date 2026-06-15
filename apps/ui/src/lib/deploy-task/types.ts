import { z } from "zod";

import type {
  DeploymentTaskCanvasProjection,
  DeploymentTaskCreatedFrom,
  DeploymentTaskRunner,
  DeploymentTaskSource,
  DeploymentTaskTarget,
  DeployTaskArtifactSummary,
  DeployTaskBlockingInput,
  DeployTaskEventPayload,
  DeployTaskMessageRow,
  DeployTaskPhase,
  DeployTaskStatus,
} from "./schema";

export type {
  DeploymentTaskCanvasProjection,
  DeploymentTaskCanvasProjectionEdge,
  DeploymentTaskCanvasProjectionExpectedRef,
  DeploymentTaskCanvasProjectionResultMapping,
  DeploymentTaskCanvasProjectionSlot,
  DeploymentTaskCreatedFrom,
  DeploymentTaskRunner,
  DeploymentTaskSource,
  DeploymentTaskTarget,
  DeployTaskArtifactSummary,
  DeployTaskBlockingInput,
  DeployTaskEventPayload,
  DeployTaskEventRow,
  DeployTaskMessageRow,
  DeployTaskPhase,
  DeployTaskRow,
  DeployTaskStatus,
} from "./schema";

export const deployTaskPhaseSchema = z.enum([
  "queued",
  "resolve-target",
  "prepare",
  "plan",
  "configure",
  "generate-artifacts",
  "apply",
  "verify",
  "completed",
]) satisfies z.ZodType<DeployTaskPhase>;

export const deployTaskStatusSchema = z.enum([
  "queued",
  "running",
  "blocked",
  "applying",
  "completed",
  "failed",
  "cancelled",
]) satisfies z.ZodType<DeployTaskStatus>;

const boundedString = z.string().trim().min(1).max(512);

export const deploymentTaskSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    branch: z.string().trim().max(256).optional(),
    kind: z.literal("github"),
    repo: z.object({
      fullName: boundedString,
      id: z.string().trim().max(128).optional(),
      name: z.string().trim().min(1).max(256),
      url: z.string().trim().url(),
    }),
  }),
  z.object({
    kind: z.literal("docker"),
    settings: z.record(z.string(), z.unknown()),
  }),
  z.object({
    kind: z.literal("database"),
    settings: z.record(z.string(), z.unknown()),
  }),
  z.object({
    args: z.record(z.string(), z.string()).optional(),
    kind: z.literal("template"),
    templateName: z.string().trim().min(1).max(256),
  }),
  z.object({
    kind: z.literal("prompt"),
    text: z.string().trim().min(1).max(4000),
  }),
]) satisfies z.ZodType<DeploymentTaskSource>;

export const deploymentTaskTargetSchema = z.discriminatedUnion("kind", [
  z.object({
    displayName: z.string().trim().min(1).max(256),
    kind: z.literal("newProject"),
  }),
  z.object({
    kind: z.literal("existingProject"),
    projectId: z.string().trim().min(1).max(256),
    projectName: z.string().trim().max(512).optional(),
  }),
]) satisfies z.ZodType<DeploymentTaskTarget>;

export const deploymentTaskRunnerSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("direct"),
  }),
  z.object({
    kind: z.literal("template"),
  }),
  z.object({
    kind: z.literal("ai"),
    runtimeProvider: z.literal("devbox"),
    skill: z.string().trim().min(1).max(256).optional(),
  }),
]) satisfies z.ZodType<DeploymentTaskRunner>;

export const createDeployTaskInputSchema = z.object({
  createdFrom: z.enum(["api", "automation", "chat", "ui"]).optional(),
  namespace: z.string().trim().min(1),
  prompt: z.string().trim().max(4000).optional(),
  runner: deploymentTaskRunnerSchema,
  source: deploymentTaskSourceSchema,
  target: deploymentTaskTargetSchema,
});

export type CreateDeployTaskInput = z.infer<typeof createDeployTaskInputSchema>;

export const deployTaskEventInputSchema = z.object({
  kind: z.string().trim().min(1).max(128),
  message: z.string().trim().max(4000).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  phase: deployTaskPhaseSchema.optional(),
});

export type DeployTaskEventInput = z.infer<typeof deployTaskEventInputSchema>;

export const submitDeployTaskInputSchema = z.object({
  values: z.record(z.string(), z.unknown()),
});

export type SubmitDeployTaskInput = z.infer<typeof submitDeployTaskInputSchema>;

const deploymentTaskCanvasProjectionExpectedRefSchema = z.object({
  kind: z.enum(["AP", "DB", "PublicAccess", "TemplateNative"]),
  name: z.string().trim().min(1),
  namespace: z.string().trim().min(1),
});

const deploymentTaskCanvasProjectionSlotSchema = z.object({
  anchor: z.boolean().optional(),
  expectedRef: deploymentTaskCanvasProjectionExpectedRefSchema.optional(),
  id: z.string().trim().min(1),
});

const deploymentTaskCanvasProjectionEdgeSchema = z.object({
  evidence: z.string().trim().min(1).optional(),
  id: z.string().trim().min(1).optional(),
  sourceSlotId: z.string().trim().min(1),
  targetSlotId: z.string().trim().min(1),
});

const deploymentTaskCanvasProjectionResultMappingSchema = z.object({
  actualRef: deploymentTaskCanvasProjectionExpectedRefSchema,
  slotId: z.string().trim().min(1),
});

export const deploymentTaskCanvasProjectionSchema = z.object({
  edges: z.array(deploymentTaskCanvasProjectionEdgeSchema).optional(),
  resultMappings: z
    .array(deploymentTaskCanvasProjectionResultMappingSchema)
    .optional(),
  slots: z.array(deploymentTaskCanvasProjectionSlotSchema).optional(),
}) satisfies z.ZodType<DeploymentTaskCanvasProjection>;

export const updateDeployTaskCanvasProjectionInputSchema = z.object({
  mode: z.enum(["set-if-empty", "replace"]).optional(),
  projection: deploymentTaskCanvasProjectionSchema,
});

export type UpdateDeployTaskCanvasProjectionInput = z.infer<
  typeof updateDeployTaskCanvasProjectionInputSchema
>;

export interface DeployTaskDTO {
  artifactSummary: DeployTaskArtifactSummary;
  blockingInputs: DeployTaskBlockingInput[];
  canvasProjection: DeploymentTaskCanvasProjection;
  completedAt: string | null;
  createdAt: string;
  createdFrom: DeploymentTaskCreatedFrom;
  error: string | null;
  gatewaySessionId: string | null;
  gatewayTurnId: string | null;
  gatewayUrl: string | null;
  id: string;
  namespace: string;
  phase: DeployTaskPhase;
  previewUrl: string | null;
  projectId: string | null;
  projectName: string | null;
  resultUrl: string | null;
  runner: DeploymentTaskRunner;
  runtimeName: string | null;
  runtimeProvider: string | null;
  runtimeState: string | null;
  source: DeploymentTaskSource;
  startedAt: string | null;
  status: DeployTaskStatus;
  target: DeploymentTaskTarget;
  updatedAt: string;
}

export interface DeployTaskEventDTO {
  createdAt: string;
  kind: string;
  message: string | null;
  payload: DeployTaskEventPayload;
  phase: DeployTaskPhase | null;
  seq: number;
  taskId: string;
}

export interface DeployTaskMessageDTO {
  createdAt: string;
  id: string;
  parts: DeployTaskMessageRow["parts"];
  role: DeployTaskMessageRow["role"];
  taskId: string;
}

export interface DeployTaskSnapshotDTO {
  events: DeployTaskEventDTO[];
  messages: DeployTaskMessageDTO[];
  task: DeployTaskDTO;
}
