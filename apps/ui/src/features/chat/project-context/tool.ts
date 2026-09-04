import "server-only";

import { tool } from "ai";
import { z } from "zod";
import type { AssistantContextPayload } from "@/features/chat/persistence/types";
import {
  chatToolIntentionField,
  logChatToolIntention,
} from "@/features/chat/tool/chat-tool-intention";
import {
  type BuildProjectContextIndexInput,
  buildProjectContextIndex,
  type ProjectContextIndex,
} from "./index";

export const DISCOVER_PROJECT_CONTEXT_TOOL_NAME =
  "discoverProjectContext" as const;

export const discoverProjectContextInputSchema = z
  .object({
    intention: chatToolIntentionField,
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();

interface ProjectContextToolOptions {
  assistantContext?: AssistantContextPayload;
  kubeconfig: string;
  kubernetesNamespace: string;
  workspaceActor: string;
}

interface ProjectContextToolDependencies {
  buildProjectContextIndex?: (
    input: BuildProjectContextIndexInput
  ) => Promise<ProjectContextIndex>;
}

/**
 * Project identity is closed over from the verified Chat request. The model
 * can tune only the bounded result size; it cannot choose a Project or
 * Namespace to probe.
 */
export function createProjectContextTools(
  options: ProjectContextToolOptions,
  dependencies: ProjectContextToolDependencies = {}
) {
  if (options.assistantContext?.kind !== "project") {
    return {};
  }
  const projectId = options.assistantContext.projectId;
  const buildIndex =
    dependencies.buildProjectContextIndex ?? buildProjectContextIndex;
  const discoverProjectContext = tool({
    description: [
      "Discover the current SealAI Project's lightweight context index.",
      "Use this when no selected resource identifies the target, or when the user asks about the Project as a whole.",
      "It returns safe references for APs, DBs, active Deployment Tasks, deployment history, and readable content without loading README bodies, logs, Kubernetes YAML, or credentials.",
      "Use the returned stable references with a dedicated reader or domain tool; display names are never resource identities.",
    ].join(" "),
    inputSchema: discoverProjectContextInputSchema,
    execute: async (input) => {
      logChatToolIntention(DISCOVER_PROJECT_CONTEXT_TOOL_NAME, input.intention);
      try {
        const index = await buildIndex({
          kubeconfig: options.kubeconfig,
          ...(input.limit === undefined ? {} : { limit: input.limit }),
          namespace: options.kubernetesNamespace,
          projectId,
          workspaceActor: options.workspaceActor,
        });
        return { index, ok: true as const };
      } catch {
        return {
          error: "Project context is unavailable.",
          ok: false as const,
        };
      }
    },
  });

  return { discoverProjectContext };
}
