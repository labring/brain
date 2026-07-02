import type { CanvasNodeAction } from "./canvas-node.actions";

/** Lifecycle verbs shared by canvas resource node menus. */
export type CanvasNodeLifecycleVerb = "delete" | "restart" | "start" | "stop";

/**
 * State-resolved presentation for one resource affordance entry.
 *
 * `present: false` removes the entry entirely — reserved for verbs that are
 * structurally inapplicable in the current state (Start while running, Stop or
 * Restart while stopped). A `disabledReason` keeps the entry visible as an
 * unavailable affordance with a user-facing reason. `inFlight` marks a verb
 * observed in progress, presented as a disabled spinner.
 */
export interface CanvasNodeActionAvailability {
  disabledReason?: string;
  inFlight?: boolean;
  present: boolean;
}

export type CanvasNodeLifecycleAvailability = Record<
  CanvasNodeLifecycleVerb,
  CanvasNodeActionAvailability
>;

export const CANVAS_NODE_FAILED_TONES: ReadonlySet<string> = new Set([
  "degraded",
  "error",
  "failed",
  "inaccessible",
  "unavailable",
  "unhealthy",
]);

export const CANVAS_NODE_RUNNING_TONES: ReadonlySet<string> = new Set([
  "available",
  "bound",
  "complete",
  "ready",
  "running",
  "succeeded",
]);

export const CANVAS_NODE_STOPPED_TONES: ReadonlySet<string> = new Set([
  "paused",
  "shutdown",
  "stopped",
  "suspended",
]);

/** Transient tones without a lifecycle verb of their own. */
export const CANVAS_NODE_BUSY_TONES: ReadonlySet<string> = new Set([
  "binding",
  "creating",
  "pending",
  "progressing",
  "reconciling",
  "updating",
]);

export function normalizeCanvasNodeStatusTone(
  input: string | undefined
): string | undefined {
  const normalized = input
    ?.trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
  return normalized === "" ? undefined : normalized;
}

const PRESENT: CanvasNodeActionAvailability = { present: true };
const HIDDEN: CanvasNodeActionAvailability = { present: false };
const IN_FLIGHT: CanvasNodeActionAvailability = {
  inFlight: true,
  present: true,
};

function unavailable(disabledReason: string): CanvasNodeActionAvailability {
  return { disabledReason, present: true };
}

/**
 * Resolves lifecycle menu entries from the workload status tone.
 *
 * Mutually exclusive verbs resolve away (hidden); anything conceptually
 * applicable but unusable right now stays visible with a reason. The in-flight
 * verb of a transient state is echoed with a spinner. `noun` is the
 * user-facing resource word used in reasons (for example "Workload" or
 * "Database").
 */
export function canvasNodeLifecycleAvailability(
  tone: string | undefined,
  noun: string
): CanvasNodeLifecycleAvailability {
  const normalized = normalizeCanvasNodeStatusTone(tone);

  if (normalized === "starting") {
    return {
      delete: PRESENT,
      restart: unavailable(`${noun} is starting.`),
      start: IN_FLIGHT,
      stop: HIDDEN,
    };
  }
  if (normalized === "stopping") {
    return {
      delete: PRESENT,
      restart: unavailable(`${noun} is stopping.`),
      start: HIDDEN,
      stop: IN_FLIGHT,
    };
  }
  if (normalized === "restarting") {
    return {
      delete: PRESENT,
      restart: IN_FLIGHT,
      start: HIDDEN,
      stop: unavailable(`${noun} is restarting.`),
    };
  }
  if (normalized === "deleting") {
    const reason = `${noun} is being deleted.`;
    return {
      delete: IN_FLIGHT,
      restart: unavailable(reason),
      start: HIDDEN,
      stop: unavailable(reason),
    };
  }
  if (
    normalized != null &&
    (CANVAS_NODE_RUNNING_TONES.has(normalized) ||
      CANVAS_NODE_FAILED_TONES.has(normalized))
  ) {
    return { delete: PRESENT, restart: PRESENT, start: HIDDEN, stop: PRESENT };
  }
  if (normalized != null && CANVAS_NODE_STOPPED_TONES.has(normalized)) {
    return { delete: PRESENT, restart: HIDDEN, start: PRESENT, stop: HIDDEN };
  }
  if (normalized != null && CANVAS_NODE_BUSY_TONES.has(normalized)) {
    const reason = `${noun} is busy right now.`;
    return {
      delete: PRESENT,
      restart: unavailable(reason),
      start: HIDDEN,
      stop: unavailable(reason),
    };
  }

  const reason = `${noun} state is unknown.`;
  return {
    delete: PRESENT,
    restart: unavailable(reason),
    start: HIDDEN,
    stop: unavailable(reason),
  };
}

/**
 * Overlays state availability onto a host-provided action. Host-provided
 * (session-level) reasons win over state reasons; an observed in-flight verb
 * always presents as loading.
 */
export function canvasNodeActionWithAvailability(
  action: CanvasNodeAction | undefined,
  availability: CanvasNodeActionAvailability
): CanvasNodeAction {
  const disabledReason = action?.disabledReason ?? availability.disabledReason;
  return {
    ...action,
    disabled: Boolean(
      action?.disabled ||
        availability.disabledReason != null ||
        availability.inFlight
    ),
    ...(disabledReason === undefined ? {} : { disabledReason }),
    loading: Boolean(action?.loading || availability.inFlight),
  };
}
