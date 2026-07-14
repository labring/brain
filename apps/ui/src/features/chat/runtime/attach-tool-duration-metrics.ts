import { isToolUIPart, type UIMessage } from "ai";

/**
 * Merges execution duration (ms) from `streamText` `experimental_onToolCallFinish`
 * into each matching tool UI part's `toolMetadata`, so it persists with the message
 * and can be rendered client-side.
 */
export function attachToolDurationMetrics<T extends UIMessage>(
  message: T,
  durationsByToolCallId: ReadonlyMap<string, number>
): T {
  if (durationsByToolCallId.size === 0) {
    return message;
  }

  return {
    ...message,
    parts: message.parts.map((part) => {
      if (!isToolUIPart(part)) {
        return part;
      }
      const durationMs = durationsByToolCallId.get(part.toolCallId);
      if (durationMs === undefined) {
        return part;
      }

      const prevMeta =
        part.toolMetadata !== undefined &&
        typeof part.toolMetadata === "object" &&
        !Array.isArray(part.toolMetadata)
          ? part.toolMetadata
          : {};

      return {
        ...part,
        toolMetadata: {
          ...prevMeta,
          durationMs,
        },
      };
    }),
  };
}
