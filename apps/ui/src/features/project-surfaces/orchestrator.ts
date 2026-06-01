import {
  EMPTY_PROJECT_SURFACE_STATE,
  type ProjectSurfaceIntent,
  type ProjectSurfaceSlot,
  type ProjectSurfaceState,
} from "./surface-state";

export function createProjectSurfaceState(
  initial?: Partial<ProjectSurfaceState>
): ProjectSurfaceState {
  return {
    ...EMPTY_PROJECT_SURFACE_STATE,
    ...initial,
  };
}

export function openProjectSurface(
  state: ProjectSurfaceState,
  intent: ProjectSurfaceIntent
): ProjectSurfaceState {
  switch (intent.slot) {
    case "side":
      return {
        ...state,
        main: null,
        side: intent.entry,
      };
    case "main":
      return {
        ...state,
        main: intent.entry,
      };
    case "drawer":
      return {
        ...state,
        drawer: intent.entry,
      };
    default:
      return state;
  }
}

export function closeProjectSurfaceSlot(
  state: ProjectSurfaceState,
  slot: ProjectSurfaceSlot
): ProjectSurfaceState {
  return {
    ...state,
    [slot]: null,
  };
}
