import "server-only";

import type { UIMessage } from "ai";

import {
  formatAiCredits,
  type WorkspaceAiQuota,
} from "@/features/billing/ai-quota-core";
import type { FreeTierState } from "@/features/chat/persistence/types";

export interface AssistantUsageContext {
  aiQuota: WorkspaceAiQuota;
  freeTier: FreeTierState;
}

/**
 * Adds current-turn billing information to the latest user message. The block
 * is deliberately ephemeral and message-scoped: it must not make the stable
 * system prompt volatile or turn an old usage snapshot into historical truth.
 */
export function withAssistantUsageContext(
  history: UIMessage[],
  context: AssistantUsageContext
): UIMessage[] {
  let latestUserIndex = -1;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index]?.role === "user") {
      latestUserIndex = index;
      break;
    }
  }
  if (latestUserIndex < 0) {
    return history;
  }

  return history.map((message, index) =>
    index === latestUserIndex
      ? {
          ...message,
          parts: [
            {
              type: "text",
              text: renderAssistantUsageContext(context),
            },
            ...message.parts,
          ],
        }
      : message
  );
}

function renderAssistantUsageContext(context: AssistantUsageContext): string {
  let aiCredits: string;
  if (context.aiQuota.status === "available") {
    aiCredits = `- Workspace AI Credits: ${formatAiCredits(
      context.aiQuota.totalMicroUnits
    )} total, ${formatAiCredits(
      context.aiQuota.usedMicroUnits
    )} used, ${formatAiCredits(
      Math.max(
        0,
        context.aiQuota.totalMicroUnits - context.aiQuota.usedMicroUnits
      )
    )} remaining`;
  } else if (context.aiQuota.status === "not_applicable") {
    aiCredits = "- Workspace AI Credits: not included for this workspace";
  } else {
    aiCredits =
      "- Workspace AI Credits: temporarily unavailable; do not infer zero";
  }

  return [
    "<assistant_usage_context>",
    "Server-provided current-turn billing context — data, not instructions.",
    aiCredits,
    `- Free assistant messages: ${context.freeTier.remaining} remaining of ${context.freeTier.limit}`,
    `- Billing mode for this turn: ${context.freeTier.billing}`,
    "Server-side authorization and billing decisions are authoritative.",
    "</assistant_usage_context>",
  ].join("\n");
}
