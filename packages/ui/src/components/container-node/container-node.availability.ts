import {
  CANVAS_NODE_FAILED_TONES,
  CANVAS_NODE_RUNNING_TONES,
  CANVAS_NODE_STOPPED_TONES,
  type CanvasNodeActionAvailability,
  type CanvasNodeLifecycleAvailability,
  canvasNodeLifecycleAvailability,
  normalizeCanvasNodeStatusTone,
} from "@workspace/ui/components/canvas-node/canvas-node.availability";

import type {
  ContainerNodeQuickActionKey,
  ContainerNodeStatusTone,
} from "./container-node.types";

const REASON_NOUN = "Workload";

/** Lifecycle menu entries resolved from the workload status tone. */
export function containerNodeLifecycleAvailability(
  tone: ContainerNodeStatusTone | string | undefined
): CanvasNodeLifecycleAvailability {
  return canvasNodeLifecycleAvailability(tone, REASON_NOUN);
}

/** Transient tones during which workload pods commonly keep serving exec. */
const ROLLING_TONES: ReadonlySet<string> = new Set([
  "progressing",
  "reconciling",
  "restarting",
  "updating",
]);

/** Transient tones during which workload pods are not up yet. */
const COMING_UP_TONES: ReadonlySet<string> = new Set([
  "binding",
  "creating",
  "pending",
  "starting",
]);

/**
 * State gates for container quick actions. Observation surfaces (logs,
 * metrics, events, image versions) keep their historical value in every state
 * and are never gated here; only the terminal needs a live pod.
 */
export function containerNodeQuickActionAvailability(
  tone: ContainerNodeStatusTone | string | undefined
): Partial<Record<ContainerNodeQuickActionKey, CanvasNodeActionAvailability>> {
  const normalized = normalizeCanvasNodeStatusTone(tone);

  if (
    normalized != null &&
    (CANVAS_NODE_RUNNING_TONES.has(normalized) ||
      CANVAS_NODE_FAILED_TONES.has(normalized) ||
      ROLLING_TONES.has(normalized))
  ) {
    return {};
  }
  if (normalized != null && CANVAS_NODE_STOPPED_TONES.has(normalized)) {
    return {
      terminal: {
        disabledReason: `${REASON_NOUN} is not running.`,
        present: true,
      },
    };
  }
  if (normalized != null && COMING_UP_TONES.has(normalized)) {
    return {
      terminal: {
        disabledReason: `${REASON_NOUN} is not running yet.`,
        present: true,
      },
    };
  }
  if (normalized === "stopping") {
    return {
      terminal: {
        disabledReason: `${REASON_NOUN} is stopping.`,
        present: true,
      },
    };
  }
  if (normalized === "deleting") {
    return {
      terminal: {
        disabledReason: `${REASON_NOUN} is being deleted.`,
        present: true,
      },
    };
  }
  return {
    terminal: {
      disabledReason: `${REASON_NOUN} state is unknown.`,
      present: true,
    },
  };
}
