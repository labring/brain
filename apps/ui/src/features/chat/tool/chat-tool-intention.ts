import { z } from "zod";

export const CHAT_TOOL_INTENTION_MIN_LEN = 8;
export const CHAT_TOOL_INTENTION_MAX_LEN = 500;
export const CHAT_TOOL_INTENTION_LOG_MAX = 400;

/**
 * Optional extra sentence for the Zod `.describe()` (keep short; model sees this per tool).
 */
export function chatToolIntentionFieldDescription(focus: string): string {
  return `Why you are calling this tool—${focus} Logged for transcripts/audit; not sent to remote APIs except as noted.`;
}

export const chatToolIntentionField = z
  .string()
  .min(CHAT_TOOL_INTENTION_MIN_LEN)
  .max(CHAT_TOOL_INTENTION_MAX_LEN)
  .describe(
    chatToolIntentionFieldDescription(
      "state goal and what changes or data you expect (one or two short clauses)."
    )
  );

export function logChatToolIntention(
  toolSlug: string,
  intention: string
): void {
  const clipped =
    intention.length <= CHAT_TOOL_INTENTION_LOG_MAX
      ? intention
      : `${intention.slice(0, CHAT_TOOL_INTENTION_LOG_MAX)}…`;
  console.info(`[chat-tool:${toolSlug}] intention=${JSON.stringify(clipped)}`);
}
