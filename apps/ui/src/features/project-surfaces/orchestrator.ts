import {
  EMPTY_PROJECT_SURFACE_STATE,
  type ProjectCanvasSelection,
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

export function setProjectCanvasSelection(
  state: ProjectSurfaceState,
  selected: ProjectCanvasSelection | null
): ProjectSurfaceState {
  return {
    ...state,
    selected,
  };
}

export function openProjectSurface(
  state: ProjectSurfaceState,
  intent: ProjectSurfaceIntent
): ProjectSurfaceState {
  const selected = intent.select === undefined ? state.selected : intent.select;

  switch (intent.slot) {
    case "side":
      return {
        ...state,
        main: null,
        selected,
        side: intent.entry,
      };
    case "main":
      return {
        ...state,
        main: intent.entry,
        selected,
      };
    case "drawer":
      return {
        ...state,
        drawer: intent.entry,
        selected,
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
