import { z } from "zod";
import { DEFAULT_DOCKER_APP_LISTENING_PORT } from "@/features/deploy/docker-deployment-settings";
import {
  type DeploymentTaskRunner,
  type DeploymentTaskSource,
  deploymentTaskTargetSchema,
} from "@/features/deploy/task/types";
import { chatToolIntentionField } from "./chat-tool-intention";

const boundedString = z.string().trim().min(1).max(512);

const chatDockerEnvVarSchema = z.object({
  name: z.string().trim().min(1),
  value: z.string(),
});

const chatDockerConfigMapSchema = z.object({
  path: z.string().trim().min(1),
  value: z.string(),
});

const chatDockerStorageSchema = z.object({
  path: z.string().trim().min(1),
  size: z.string().trim().min(1),
});

const chatDockerDeploymentSettingsSchema = z.object({
  appListeningPort: z
    .number()
    .int()
    .min(1)
    .max(65_535)
    .default(DEFAULT_DOCKER_APP_LISTENING_PORT),
  args: z.array(z.string().trim().min(1)).optional(),
  command: z.array(z.string().trim().min(1)).optional(),
  configMaps: z.array(chatDockerConfigMapSchema).optional(),
  env: z.array(chatDockerEnvVarSchema).default([]),
  image: z.string().trim().min(1).max(512),
  storage: z.array(chatDockerStorageSchema).optional(),
});

export const chatDeploymentTaskSourceSchema = z.discriminatedUnion("kind", [
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
    settings: chatDockerDeploymentSettingsSchema,
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
]);

export const createDeployTaskToolInputSchema = z.object({
  intention: chatToolIntentionField,
  prompt: z.string().trim().max(4000).optional(),
  source: chatDeploymentTaskSourceSchema,
  target: deploymentTaskTargetSchema.optional(),
});

export function defaultRunnerForSource(
  source: DeploymentTaskSource
): DeploymentTaskRunner {
  switch (source.kind) {
    case "database":
    case "docker":
      return { kind: "direct" };
    case "github":
    case "prompt":
      return {
        kind: "ai",
        runtimeProvider: "devbox",
        skill: "sealos-deploy",
      };
    case "template":
      return { kind: "template" };
    default:
      return source satisfies never;
  }
}
