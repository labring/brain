import type { ToolSet } from "ai";

function mergeChunkToolMetadata<
  Chunk extends { toolCallId: string; toolMetadata?: unknown },
>(chunk: Chunk, durationMsByToolCallId: ReadonlyMap<string, number>): Chunk {
  const ms = durationMsByToolCallId.get(chunk.toolCallId);
  if (ms === undefined) {
    return chunk;
  }
  const prev =
    chunk.toolMetadata !== undefined &&
    typeof chunk.toolMetadata === "object" &&
    !Array.isArray(chunk.toolMetadata)
      ? (chunk.toolMetadata as Record<string, unknown>)
      : {};
  return {
    ...chunk,
    toolMetadata: { ...prev, durationMs: ms },
  };
}

/**
 * Merges `durationMs` (from `experimental_onToolCallFinish`) into streaming
 * `tool-result` / `tool-error` parts so `toUIMessageStreamResponse` passes it
 * through to the client as `toolMetadata.durationMs` on each tool UI part.
 */
export function createInjectToolDurationStreamTransform<TTools extends ToolSet>(
  durationMsByToolCallId: Map<string, number>
) {
  return (_options: { tools: TTools; stopStream: () => void }) =>
    new TransformStream({
      transform(chunk, controller) {
        if (chunk.type === "tool-result" || chunk.type === "tool-error") {
          controller.enqueue(
            mergeChunkToolMetadata(chunk, durationMsByToolCallId)
          );
          return;
        }
        controller.enqueue(chunk);
      },
    });
}
