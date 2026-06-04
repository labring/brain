import { z } from "zod";

import type {
  DeployTaskArtifactSummary,
  DeployTaskBlockingInput,
  DeployTaskEventPayload,
  DeployTaskMessageRow,
  DeployTaskPhase,
  DeployTaskStatus,
} from "@/lib/chat-persistence/schema";

export type {
  DeployTaskArtifactSummary,
  DeployTaskBlockingInput,
  DeployTaskEventPayload,
  DeployTaskEventRow,
  DeployTaskMessageRow,
  DeployTaskPhase,
  DeployTaskRow,
  DeployTaskStatus,
} from "@/lib/chat-persistence/schema";

export const deployTaskPhaseSchema = z.enum([
  "queued",
  "runtime",
  "workspace",
  "analyze",
  "configure",
  "generate",
  "apply",
  "preview",
  "ship",
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

export const createDeployTaskInputSchema = z.object({
  branch: z.string().trim().max(256).optional(),
  namespace: z.string().trim().min(1),
  projectName: z.string().trim().max(512).optional(),
  projectId: z.string().trim().max(256).optional(),
  prompt: z.string().trim().max(4000).optional(),
  repo: z.object({
    fullName: z.string().trim().min(1).max(512),
    id: z.string().trim().max(128).optional(),
    name: z.string().trim().min(1).max(256),
    url: z.string().trim().url(),
  }),
  selectedWorkloadUid: z.string().trim().max(256).optional(),
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

export interface DeployTaskDTO {
  artifactSummary: DeployTaskArtifactSummary;
  blockingInputs: DeployTaskBlockingInput[];
  branch: string | null;
  completedAt: string | null;
  createdAt: string;
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
  repoFullName: string;
  repoName: string;
  repoUrl: string;
  resultUrl: string | null;
  runtimeName: string | null;
  runtimeProvider: string | null;
  runtimeState: string | null;
  selectedWorkloadUid: string | null;
  startedAt: string | null;
  status: DeployTaskStatus;
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
