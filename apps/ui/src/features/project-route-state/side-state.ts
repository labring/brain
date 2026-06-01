import type { ProjectSideSurfaceEntry } from "@/features/project-surfaces/surface-state";

export interface ProjectSideRouteState {
  side: ProjectSideSurfaceEntry | null;
}

export const EMPTY_PROJECT_SIDE_ROUTE_STATE: ProjectSideRouteState = {
  side: null,
};
