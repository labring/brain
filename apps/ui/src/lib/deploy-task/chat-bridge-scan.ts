import type { UIMessage } from "ai";
import { isToolUIPart } from "ai";
import type { DeployTaskCreatedEventDetail } from "./browser-events";

function recordValue(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function deployTaskDetailFromCreateToolPart(
  part: UIMessage["parts"][number]
): DeployTaskCreatedEventDetail | null {
  if (
    !isToolUIPart(part) ||
    part.type !== "tool-createDeployTask" ||
    part.state !== "output-available"
  ) {
    return null;
  }

  const output = recordValue(part.output);
  if (output?.ok !== true) {
    return null;
  }
  const task = recordValue(output.task);
  const taskId = stringValue(task?.id);
  const projectId = stringValue(task?.projectId);
  if (projectId == null || taskId == null) {
    return null;
  }
  return {
    projectId,
    taskId,
  };
}

export interface DeployTaskChatBridgeScan {
  /** Newly discovered creations, project-matched and deduplicated. */
  details: DeployTaskCreatedEventDetail[];
  /** Next cursor: settled-prefix length per message id present in `messages`. */
  scannedParts: ReadonlyMap<string, number>;
}

const SETTLED_CREATE_TOOL_STATES = new Set([
  "output-available",
  "output-error",
  "output-denied",
]);

/**
 * A create tool part that is still pending settles by IN-PLACE state mutation
 * (the AI SDK's `updateToolPart` finds it by toolCallId and rewrites `state`
 * without changing `parts.length`), so the cursor must not advance past it.
 */
function isUnsettledCreateToolPart(part: UIMessage["parts"][number]): boolean {
  return (
    isToolUIPart(part) &&
    part.type === "tool-createDeployTask" &&
    !SETTLED_CREATE_TOOL_STATES.has(part.state)
  );
}

/**
 * Incremental scan of chat messages for deploy-task creations. `scannedParts`
 * is the previous scan's cursor: for each message id, the length of the
 * leading run of parts that can no longer produce a new creation. Only parts
 * past the cursor are re-examined, so per-update cost is O(new or pending
 * parts), not O(transcript). Pure: inputs are not mutated.
 */
function scanMessageForCreations(options: {
  message: UIMessage;
  projectId: string;
  start: number;
  seenTaskIds: ReadonlySet<string>;
  reportedTaskIds: Set<string>;
  details: DeployTaskCreatedEventDetail[];
}): number {
  const { message, projectId, start, seenTaskIds, reportedTaskIds, details } =
    options;
  let cursor = start;
  let cursorParked = false;

  for (let i = start; i < message.parts.length; i += 1) {
    const part = message.parts[i];
    if (part === undefined) {
      cursor = cursorParked ? cursor : i + 1;
      continue;
    }
    const detail = deployTaskDetailFromCreateToolPart(part);
    if (
      detail != null &&
      detail.projectId === projectId &&
      !seenTaskIds.has(detail.taskId) &&
      !reportedTaskIds.has(detail.taskId)
    ) {
      reportedTaskIds.add(detail.taskId);
      details.push(detail);
    }
    if (!cursorParked && isUnsettledCreateToolPart(part)) {
      cursorParked = true;
    }
    if (!cursorParked) {
      cursor = i + 1;
    }
  }

  return cursor;
}

export function scanMessagesForDeployTaskCreations({
  messages,
  projectId,
  scannedParts,
  seenTaskIds,
}: {
  messages: readonly UIMessage[];
  projectId: string;
  scannedParts: ReadonlyMap<string, number>;
  seenTaskIds: ReadonlySet<string>;
}): DeployTaskChatBridgeScan {
  const details: DeployTaskCreatedEventDetail[] = [];
  const reportedTaskIds = new Set<string>();
  const nextScannedParts = new Map<string, number>();

  for (const message of messages) {
    const recorded = scannedParts.get(message.id) ?? 0;
    // Fewer parts than recorded means the message was replaced/truncated —
    // the cursor no longer describes this content, so rescan it fully.
    const start = recorded > message.parts.length ? 0 : recorded;
    const cursor = scanMessageForCreations({
      details,
      message,
      projectId,
      reportedTaskIds,
      seenTaskIds,
      start,
    });
    nextScannedParts.set(message.id, cursor);
  }

  return { details, scannedParts: nextScannedParts };
}
