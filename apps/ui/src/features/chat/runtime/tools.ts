import "server-only";

import { type ToolSet, tool } from "ai";
import {
  buildEmitGenUISpecDescription,
  executeEmitGenUISpec,
  genUISpecInputSchema,
} from "@/features/chat/agui/gen-ui-tool";
import { getChatDevboxSkillsSnapshot } from "@/features/chat/devbox/chat-runtime";
import type { AssistantContextPayload } from "@/features/chat/persistence/types";
import { createChatBashTool } from "@/features/chat/tool/chat-bash-tool";
import { createDeployTaskTools } from "@/features/chat/tool/chat-deploy-task-tool";
import { navigateAppTool } from "@/features/chat/tool/chat-navigate-app-tool";
import { openProjectSurfaceTool } from "@/features/chat/tool/chat-open-project-surface-tool";
import { createChatProductTools } from "@/features/chat/tool/chat-product-tools";
import { createChatProjectTools } from "@/features/chat/tool/chat-project-tools";
import { refreshFrontendSwrCachesTool } from "@/features/chat/tool/chat-refresh-frontend-swr-tool";
import {
  buildChatSkillsDiscoveryPrompt,
  createLoadSkillResourceTool,
  createLoadSkillTool,
} from "@/features/chat/tool/chat-skill-tool";
import {
  chatToolIntentionField,
  logChatToolIntention,
} from "@/features/chat/tool/chat-tool-intention";
import { sliceOpenApiDocsTool } from "@/features/chat/tool/openapi-doc-slice-tool";
import { readApiOpenApiDocsTool } from "@/features/chat/tool/read-api-openapi-docs-tool";

import { CHAT_BASE_SYSTEM_PROMPT } from "./model";
import { buildAssistantWorkspaceContextPrompt } from "./workspace-context-prompt";

const emitGenUISpecInputSchema = genUISpecInputSchema.extend({
  intention: chatToolIntentionField,
});

const emitGenUISpec = tool({
  description: buildEmitGenUISpecDescription(),
  inputSchema: emitGenUISpecInputSchema,
  execute: (input) => {
    logChatToolIntention("emitGenUISpec", input.intention);
    return executeEmitGenUISpec({ spec: input.spec });
  },
});

export interface ChatToolset {
  systemPrompt: string;
  tools: ToolSet;
}

/**
 * Assemble the per-request tool registry + system prompt.
 *
 * - Skill index drives both the `loadSkill` tool and the discovery prompt addendum.
 * - The shared Chat Devbox remains lazy; Skill metadata comes from the
 *   background warmup cache and never blocks the chat stream preflight.
 */
export async function buildChatToolset({
  kubeconfig,
  kubernetesNamespace,
  chatId,
  workspaceActor,
  workspaceUserUid,
  assistantContext,
}: {
  chatId: string;
  kubeconfig: string;
  kubernetesNamespace: string;
  workspaceActor: string;
  workspaceUserUid: string;
  assistantContext?: AssistantContextPayload;
}): Promise<ChatToolset> {
  const { tools: bashTools, lazySandbox } = await createChatBashTool({
    kubeconfig,
    namespace: kubernetesNamespace,
  });
  const skillIndex = getChatDevboxSkillsSnapshot({
    kubeconfig,
    namespace: kubernetesNamespace,
  });
  const deployTaskTools = createDeployTaskTools({
    assistantContext,
    kubeconfig,
    kubernetesNamespace,
    workspaceActor,
  });
  const productTools = createChatProductTools({
    kubeconfig,
    kubernetesNamespace,
  });
  const projectTools = createChatProjectTools({
    chatId,
    kubeconfig,
    kubernetesNamespace,
    workspaceUserUid,
  });

  const tools = {
    ...deployTaskTools,
    ...productTools,
    ...projectTools,
    emitGenUISpec,
    navigateApp: navigateAppTool,
    openProjectSurface: openProjectSurfaceTool,
    refreshFrontendSwrCaches: refreshFrontendSwrCachesTool,
    readApiOpenApiDocs: readApiOpenApiDocsTool,
    sliceOpenApiDocs: sliceOpenApiDocsTool,
    loadSkill: createLoadSkillTool(skillIndex, lazySandbox),
    loadSkillResource: createLoadSkillResourceTool(skillIndex, lazySandbox),
    ...bashTools,
  } as unknown as ToolSet;

  const workspaceBlock = buildAssistantWorkspaceContextPrompt({
    kubernetesNamespace,
    assistantContext,
  }).trimEnd();

  const systemPromptParts = [
    CHAT_BASE_SYSTEM_PROMPT,
    ...(workspaceBlock.length > 0 ? [workspaceBlock] : []),
    buildChatSkillsDiscoveryPrompt(skillIndex),
  ];

  const systemPrompt = systemPromptParts.join("\n\n");

  return { tools, systemPrompt };
}
