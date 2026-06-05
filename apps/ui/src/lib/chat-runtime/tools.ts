import "server-only";

import {
  buildEmitGenUISpecDescription,
  executeEmitGenUISpec,
  genUISpecInputSchema,
} from "@workspace/ui/lib/gen-ui-tool";
import { type ToolSet, tool } from "ai";
import type { AssistantContextPayload } from "@/lib/chat-persistence/types";
import { createChatBashTool } from "@/lib/tool/chat-bash-tool";
import { createDeployTaskTools } from "@/lib/tool/chat-deploy-task-tool";
import { navigateAppTool } from "@/lib/tool/chat-navigate-app-tool";
import { openProjectSurfaceTool } from "@/lib/tool/chat-open-project-surface-tool";
import { createChatProductTools } from "@/lib/tool/chat-product-tools";
import { refreshFrontendSwrCachesTool } from "@/lib/tool/chat-refresh-frontend-swr-tool";
import {
  buildChatSkillsDiscoveryPrompt,
  createLoadSkillTool,
  discoverPublicSkills,
} from "@/lib/tool/chat-skill-tool";
import {
  chatToolIntentionField,
  logChatToolIntention,
} from "@/lib/tool/chat-tool-intention";
import { sliceOpenApiDocsTool } from "@/lib/tool/openapi-doc-slice-tool";
import { readApiOpenApiDocsTool } from "@/lib/tool/read-api-openapi-docs-tool";

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
 * - Bash tool Devbox is created lazily; it does not start a runtime until the
 *   model actually invokes a bash subtool.
 */
export async function buildChatToolset({
  kubeconfig,
  kubernetesNamespace,
  assistantContext,
}: {
  kubeconfig: string;
  kubernetesNamespace: string;
  assistantContext?: AssistantContextPayload;
}): Promise<ChatToolset> {
  const [skillIndex, { tools: bashTools }] = await Promise.all([
    discoverPublicSkills(),
    createChatBashTool({ kubeconfig, namespace: kubernetesNamespace }),
  ]);
  const deployTaskTools = createDeployTaskTools({
    assistantContext,
    kubernetesNamespace,
  });
  const productTools = createChatProductTools({
    kubeconfig,
    kubernetesNamespace,
  });

  const tools = {
    ...deployTaskTools,
    ...productTools,
    emitGenUISpec,
    navigateApp: navigateAppTool,
    openProjectSurface: openProjectSurfaceTool,
    refreshFrontendSwrCaches: refreshFrontendSwrCachesTool,
    readApiOpenApiDocs: readApiOpenApiDocsTool,
    sliceOpenApiDocs: sliceOpenApiDocsTool,
    loadSkill: createLoadSkillTool(skillIndex),
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
