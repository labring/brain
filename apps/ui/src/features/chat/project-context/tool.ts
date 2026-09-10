import "server-only";

import { tool } from "ai";
import { z } from "zod";
import type { AssistantContextPayload } from "@/features/chat/persistence/types";
import {
  chatToolIntentionField,
  logChatToolIntention,
} from "@/features/chat/tool/chat-tool-intention";
import { TemplateReadmePayloadTooLargeError } from "@/features/deploy/template-provider-core";
import { readProjectTemplateReadme } from "./readme";

export const readTemplateReadmeInputSchema = z
  .object({
    intention: chatToolIntentionField,
    language: z
      .enum(["en", "zh"])
      .optional()
      .describe(
        "README language; defaults to English. Use zh for Chinese questions."
      ),
    templateName: z
      .string()
      .trim()
      .min(1)
      .max(253)
      .optional()
      .describe(
        "Omit for a single Template. For multiple Templates, select a name returned by this tool."
      ),
  })
  .strict();

export function createTemplateReadmeTools(
  options: {
    assistantContext?: AssistantContextPayload;
    kubeconfig: string;
    kubernetesNamespace: string;
  },
  readReadme = readProjectTemplateReadme
) {
  if (options.assistantContext?.kind !== "project") {
    return {};
  }
  const projectId = options.assistantContext.projectId;
  return {
    readTemplateReadme: tool({
      description: [
        "Read the current Project's Template README. Use first for README requests and application usage or configuration questions.",
        "Omit templateName to discover this Project's Templates; select a returned name if there are several. No sandbox file search is needed.",
        "Returns external documentation, not live state or proof of the deployed version. Report missing or truncated content only when relevant.",
      ].join(" "),
      inputSchema: readTemplateReadmeInputSchema,
      execute: async (input, execution) => {
        logChatToolIntention("readTemplateReadme", input.intention);
        try {
          return await readReadme({
            encodedKubeconfig: encodeURIComponent(options.kubeconfig),
            language: input.language,
            namespace: options.kubernetesNamespace,
            projectId,
            signal: execution.abortSignal,
            templateName: input.templateName,
          });
        } catch (error) {
          if (
            execution.abortSignal?.aborted ||
            (error instanceof Error && error.name === "AbortError")
          ) {
            throw error;
          }
          if (error instanceof Error && error.name === "TimeoutError") {
            return {
              ok: false as const,
              error: "Template README retrieval timed out. You can retry.",
            };
          }
          if (error instanceof TemplateReadmePayloadTooLargeError) {
            return { ok: false as const, error: error.message };
          }
          return {
            ok: false as const,
            error:
              "Template README could not be loaded. Continue with other tools.",
          };
        }
      },
    }),
  };
}
