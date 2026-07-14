import type { ProjectSideSurfaceEntry } from "@/features/panes/surface-state";

export interface ProjectSideRouteState {
  side: ProjectSideSurfaceEntry | null;
}

export const EMPTY_PROJECT_SIDE_ROUTE_STATE: ProjectSideRouteState = {
  side: null,
};
