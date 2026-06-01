import type { ProjectSurfaceState } from "@/features/project-surfaces/surface-state";
import type { ProjectCanvasSelection } from "./canvas-selection";

export interface ProjectWorkbenchRouteState {
  canvasSelection: ProjectCanvasSelection | null;
  surfaces: ProjectSurfaceState;
}

export const EMPTY_PROJECT_WORKBENCH_ROUTE_STATE: ProjectWorkbenchRouteState = {
  canvasSelection: null,
  surfaces: {
    drawer: null,
    main: null,
    side: null,
  },
};
