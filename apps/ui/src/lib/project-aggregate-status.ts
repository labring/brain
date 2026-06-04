import type { CanvasNodeVisualStatusTone } from "@workspace/ui/components/canvas-node/canvas-node.types";

/**
 * 5-tone visual status vocabulary used by the canvas surface and the project list.
 * Re-exported from the canvas node types so the project list and the canvas share
 * one tone alphabet — see CONTEXT.md "Project Aggregate Status uses the canvas
 * 5-tone visual scale".
 */
export type VisualTone = CanvasNodeVisualStatusTone;

/**
 * Maps a raw workload phase string (e.g. `"Running"`, `"Creating"`, `"Failed"`,
 * `"Paused"`, `""`) onto the 5-tone {@link VisualTone}. Case-insensitive; unknown
 * or empty input → `"neutral"`.
 */
const PHASE_TO_TONE: Readonly<Record<string, VisualTone>> = {
  // Ready / healthy
  running: "positive",
  succeeded: "positive",
  ready: "positive",
  available: "positive",
  bound: "positive",
  // In progress / waiting (blue dot on canvas surface)
  pending: "progress",
  creating: "progress",
  progressing: "progress",
  binding: "progress",
  restarting: "progress",
  starting: "progress",
  stopping: "progress",
  updating: "progress",
  unknown: "progress",
  // Stopped / paused → neutral (do not promote project severity)
  paused: "neutral",
  stopped: "neutral",
  shutdown: "neutral",
  // Error / failed
  failed: "negative",
  error: "negative",
  degraded: "negative",
  deleting: "negative",
  unavailable: "negative",
};

export function phaseToVisualTone(phase: string | undefined): VisualTone {
  if (phase === undefined) {
    return "neutral";
  }
  const key = phase.trim().toLowerCase();
  return PHASE_TO_TONE[key] ?? "neutral";
}

/**
 * One workload contributing to a project's aggregate health. Flat shape so
 * future sources (EntryPoint reachability, sandbox runners, external workloads)
 * can append without changing the call site — see PRD User Story 26.
 */
export interface ProjectWorkloadStatusInput {
  paused?: boolean;
  phase: string | undefined;
  projectId: string;
}

/**
 * Groups workloads by `projectId` and returns the worst tone per project,
 * with severity ordered `negative > warning > progress > positive > neutral`.
 * Paused workloads contribute as `neutral` so they cannot promote a project
 * to a worse tone (PRD User Story 7).
 *
 * Projects with no contributing workloads do not appear in the returned map.
 * Callers (e.g. the row mapper) decide what to render for missing entries,
 * typically a neutral dot for "empty / loading" rows.
 *
 * The `warning` slot is included in the severity ordering for forward-
 * compatibility (e.g. future EntryPoint reachability source); no current
 * workload phase maps to `warning` on this surface.
 */
const TONE_SEVERITY: Readonly<Record<VisualTone, number>> = {
  neutral: 0,
  positive: 1,
  progress: 2,
  warning: 3,
  negative: 4,
};

function workloadTone(workload: ProjectWorkloadStatusInput): VisualTone {
  if (workload.paused === true) {
    return "neutral";
  }
  return phaseToVisualTone(workload.phase);
}

export function aggregateProjectStatuses(
  workloads: readonly ProjectWorkloadStatusInput[]
): ReadonlyMap<string, VisualTone> {
  const result = new Map<string, VisualTone>();
  for (const workload of workloads) {
    const tone = workloadTone(workload);
    const current = result.get(workload.projectId);
    if (current === undefined || TONE_SEVERITY[tone] > TONE_SEVERITY[current]) {
      result.set(workload.projectId, tone);
    }
  }
  return result;
}
