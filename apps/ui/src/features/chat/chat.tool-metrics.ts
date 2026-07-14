/** Server merges execution time here (`experimental_onToolCallFinish`). */
export function readDurationMsFromToolMetadata(
  toolMetadata: unknown
): number | undefined {
  if (
    toolMetadata !== null &&
    typeof toolMetadata === "object" &&
    !Array.isArray(toolMetadata) &&
    "durationMs" in toolMetadata
  ) {
    const raw = (toolMetadata as { durationMs: unknown }).durationMs;
    if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
      return raw;
    }
  }
  return undefined;
}

/** Compact duration label for tool rows and compact surfaces. */
export function formatToolDurationMs(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(ms >= 10_000 ? 0 : 1)}s`;
}
