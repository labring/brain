import type {
  CanvasNodeStatus,
  CanvasNodeVisualStatusTone,
} from "@workspace/ui/components/canvas-node/canvas-node";

import type {
  EntryNodeAddress,
  EntryNodeGroup,
  EntryNodeTargetStatus,
} from "./entry-node.types";

type EntryNodeTargetStatusBucket =
  | "accessible"
  | "failed"
  | "neutral"
  | "progressing"
  | "warning";

const ACCESSIBLE_TONES = new Set([
  "accessible",
  "available",
  "bound",
  "complete",
  "ready",
  "running",
  "succeeded",
]);

const PROGRESSING_TONES = new Set([
  "binding",
  "creating",
  "pending",
  "progressing",
]);

const WARNING_TONES = new Set(["degraded", "deleting", "stopping"]);

const FAILED_TONES = new Set(["error", "failed", "inaccessible", "unhealthy"]);

const NEUTRAL_TONES = new Set([
  "not-configured",
  "shutdown",
  "stopped",
  "unknown",
]);

function normalizeEntryNodeTargetTone(input: string | undefined) {
  return input
    ?.trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
}

function getBucketForVisualTone(
  visualTone: CanvasNodeVisualStatusTone | undefined
): EntryNodeTargetStatusBucket | undefined {
  switch (visualTone) {
    case "positive":
      return "accessible";
    case "progress":
      return "progressing";
    case "warning":
      return "warning";
    case "negative":
      return "failed";
    case "neutral":
      return "neutral";
    default:
      return undefined;
  }
}

function getVisualToneForBucket(
  bucket: EntryNodeTargetStatusBucket
): CanvasNodeVisualStatusTone {
  switch (bucket) {
    case "accessible":
      return "positive";
    case "progressing":
      return "progress";
    case "warning":
      return "warning";
    case "failed":
      return "negative";
    case "neutral":
      return "neutral";
    default:
      return "neutral";
  }
}

function resolveTargetBucket(
  status: EntryNodeTargetStatus | undefined
): EntryNodeTargetStatusBucket {
  const visualBucket = getBucketForVisualTone(status?.visualTone);

  if (visualBucket) {
    return visualBucket;
  }

  const tone = normalizeEntryNodeTargetTone(status?.tone ?? status?.label);

  if (tone && ACCESSIBLE_TONES.has(tone)) {
    return "accessible";
  }

  if (tone && PROGRESSING_TONES.has(tone)) {
    return "progressing";
  }

  if (tone && WARNING_TONES.has(tone)) {
    return "warning";
  }

  if (tone && FAILED_TONES.has(tone)) {
    return "failed";
  }

  if (tone && NEUTRAL_TONES.has(tone)) {
    return "neutral";
  }

  return "neutral";
}

export function resolveEntryNodeTargetVisualStatus(
  status: EntryNodeTargetStatus | undefined
): CanvasNodeStatus {
  const bucket = resolveTargetBucket(status);

  return {
    label: status?.label?.trim() || "Unknown",
    visualTone: getVisualToneForBucket(bucket),
  };
}

function everyTone(
  buckets: EntryNodeTargetStatusBucket[],
  bucket: EntryNodeTargetStatusBucket
) {
  return buckets.every((item) => item === bucket);
}

/** Aggregate health of every address on the node, regardless of grouping. */
export function resolveEntryNodeTargetStatus(
  addresses: readonly Pick<EntryNodeAddress, "status">[] | undefined
): CanvasNodeStatus {
  if (!addresses || addresses.length === 0) {
    return { label: "Not configured", visualTone: "neutral" };
  }

  const buckets = addresses.map((address) =>
    resolveTargetBucket(address.status)
  );

  if (everyTone(buckets, "accessible")) {
    return { label: "Accessible", visualTone: "positive" };
  }

  if (everyTone(buckets, "progressing")) {
    return { label: "Progressing", visualTone: "progress" };
  }

  if (everyTone(buckets, "failed")) {
    return { label: "Inaccessible", visualTone: "negative" };
  }

  if (everyTone(buckets, "neutral")) {
    return { label: "Not configured", visualTone: "neutral" };
  }

  return { label: "Degraded", visualTone: "warning" };
}

export function entryNodeAddresses(
  groups: readonly EntryNodeGroup[] | undefined
): EntryNodeAddress[] {
  return (groups ?? []).flatMap((group) => group.addresses);
}

export function resolveEntryNodeGroupsStatus(
  groups: readonly EntryNodeGroup[] | undefined
): CanvasNodeStatus {
  return resolveEntryNodeTargetStatus(entryNodeAddresses(groups));
}
