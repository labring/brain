import type { ProjectSideSurfaceEntry } from "@/features/project-surfaces/surface-state";
import type { ProjectSideRouteState } from "./side-state";

export type ProjectRouteLeaveRequirement = {
  action: "close" | "hide" | "switch";
  surface: "side";
} | null;

export interface ProjectRouteTransition<TState> {
  next: TState;
  requiredLeave: ProjectRouteLeaveRequirement;
}

export function planOpenProjectSideRouteState(
  state: ProjectSideRouteState,
  entry: ProjectSideSurfaceEntry
): ProjectRouteTransition<ProjectSideRouteState> {
  return {
    next: { side: entry },
    requiredLeave:
      state.side == null ? null : { action: "switch", surface: "side" },
  };
}

export function planCloseProjectSideRouteState(
  state: ProjectSideRouteState
): ProjectRouteTransition<ProjectSideRouteState> {
  return {
    next: { side: null },
    requiredLeave:
      state.side == null ? null : { action: "close", surface: "side" },
  };
}

export function repairUnsupportedProjectSideRouteState(
  state: ProjectSideRouteState,
  isSideEntrySupported: (entry: ProjectSideSurfaceEntry) => boolean
): ProjectRouteTransition<ProjectSideRouteState> {
  if (state.side == null || isSideEntrySupported(state.side)) {
    return { next: state, requiredLeave: null };
  }
  return { next: { side: null }, requiredLeave: null };
}
