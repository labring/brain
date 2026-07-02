import {
  CANVAS_NODE_BUSY_TONES,
  CANVAS_NODE_FAILED_TONES,
  CANVAS_NODE_RUNNING_TONES,
  CANVAS_NODE_STOPPED_TONES,
  type CanvasNodeActionAvailability,
  type CanvasNodeLifecycleAvailability,
  canvasNodeLifecycleAvailability,
  normalizeCanvasNodeStatusTone,
} from "@workspace/ui/components/canvas-node/canvas-node.availability";

import type {
  DatabaseNodeQuickActionKey,
  DatabaseNodeStatusTone,
} from "./database-node.types";

const REASON_NOUN = "Database";

/** Lifecycle menu entries resolved from the database status tone. */
export function databaseNodeLifecycleAvailability(
  tone: DatabaseNodeStatusTone | string | undefined
): CanvasNodeLifecycleAvailability {
  return canvasNodeLifecycleAvailability(tone, REASON_NOUN);
}

function liveSessionGate(disabledReason: string) {
  const entry: CanvasNodeActionAvailability = { disabledReason, present: true };
  return { dbAccess: entry, terminal: entry };
}

/**
 * State gates for database quick actions. Terminal and DB Access sessions are
 * accepted by the platform only while the database reports a running phase, so
 * both mirror that gate; failed databases are rejected as well. Logs and
 * metrics keep their historical value in every state and are never gated here.
 */
export function databaseNodeQuickActionAvailability(
  tone: DatabaseNodeStatusTone | string | undefined
): Partial<Record<DatabaseNodeQuickActionKey, CanvasNodeActionAvailability>> {
  const normalized = normalizeCanvasNodeStatusTone(tone);

  if (normalized != null && CANVAS_NODE_RUNNING_TONES.has(normalized)) {
    return {};
  }
  if (normalized != null && CANVAS_NODE_STOPPED_TONES.has(normalized)) {
    return liveSessionGate(`${REASON_NOUN} is not running.`);
  }
  if (normalized != null && CANVAS_NODE_FAILED_TONES.has(normalized)) {
    return liveSessionGate(`${REASON_NOUN} is not ready.`);
  }
  if (normalized === "starting") {
    return liveSessionGate(`${REASON_NOUN} is starting.`);
  }
  if (normalized === "stopping") {
    return liveSessionGate(`${REASON_NOUN} is stopping.`);
  }
  if (normalized === "restarting") {
    return liveSessionGate(`${REASON_NOUN} is restarting.`);
  }
  if (normalized === "deleting") {
    return liveSessionGate(`${REASON_NOUN} is being deleted.`);
  }
  if (normalized != null && CANVAS_NODE_BUSY_TONES.has(normalized)) {
    return liveSessionGate(`${REASON_NOUN} is busy right now.`);
  }
  return liveSessionGate(`${REASON_NOUN} state is unknown.`);
}
