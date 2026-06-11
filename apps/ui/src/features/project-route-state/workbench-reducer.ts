import {
  closeProjectSurfaceSlot,
  openProjectSurface,
} from "@/features/project-surfaces/orchestrator";
import {
  mainSurfaceFocusPolicy,
  type ProjectDrawerSurfaceEntry,
  type ProjectMainSurfaceEntry,
  type ProjectSideSurfaceEntry,
  type ProjectSurfaceIntent,
  type ProjectSurfaceSlot,
  projectSideSurfaceVisible,
  projectSurfaceEntryTarget,
} from "@/features/project-surfaces/surface-state";
import type { ProjectSurfaceTarget } from "@/features/project-surfaces/target-identity";
import {
  type ProjectCanvasSelection,
  projectCanvasSelectionTarget,
} from "./canvas-selection";
import type {
  ProjectRouteLeaveRequirement,
  ProjectRouteTransition,
} from "./side-reducer";
import type { ProjectWorkbenchRouteState } from "./workbench-state";

export type ProjectWorkbenchSurfaceIntent =
  | {
      canvasSelection?: ProjectCanvasSelection | null;
      entry: ProjectSideSurfaceEntry;
      slot: "side";
    }
  | {
      canvasSelection?: ProjectCanvasSelection | null;
      entry: ProjectMainSurfaceEntry;
      slot: "main";
    }
  | {
      canvasSelection?: ProjectCanvasSelection | null;
      entry: ProjectDrawerSurfaceEntry;
      slot: "drawer";
    };

function surfaceIntentFromWorkbenchIntent(
  intent: ProjectWorkbenchSurfaceIntent
): ProjectSurfaceIntent {
  switch (intent.slot) {
    case "side":
      return { entry: intent.entry, slot: "side" };
    case "main":
      return { entry: intent.entry, slot: "main" };
    case "drawer":
      return { entry: intent.entry, slot: "drawer" };
    default:
      return intent satisfies never;
  }
}

function leaveRequiredForOpenSurface(
  state: ProjectWorkbenchRouteState,
  intent: ProjectWorkbenchSurfaceIntent,
  next: ProjectWorkbenchRouteState
): ProjectRouteLeaveRequirement {
  if (intent.slot === "side" && state.surfaces.side != null) {
    return { action: "switch", surface: "side" };
  }

  if (
    intent.slot === "main" &&
    projectSideSurfaceVisible(state.surfaces) &&
    next.surfaces.side != null &&
    mainSurfaceFocusPolicy(intent.entry) !== "keepSideVisible"
  ) {
    return { action: "hide", surface: "side" };
  }

  return null;
}

export function planOpenProjectWorkbenchSurface(
  state: ProjectWorkbenchRouteState,
  intent: ProjectWorkbenchSurfaceIntent
): ProjectRouteTransition<ProjectWorkbenchRouteState> {
  const surfaces = openProjectSurface(
    state.surfaces,
    surfaceIntentFromWorkbenchIntent(intent)
  );
  const next = {
    canvasSelection:
      intent.canvasSelection === undefined
        ? state.canvasSelection
        : intent.canvasSelection,
    surfaces,
  };

  return {
    next,
    requiredLeave: leaveRequiredForOpenSurface(state, intent, next),
  };
}

export function planCloseProjectWorkbenchSurfaceSlot(
  state: ProjectWorkbenchRouteState,
  slot: ProjectSurfaceSlot
): ProjectRouteTransition<ProjectWorkbenchRouteState> {
  return {
    next: {
      ...state,
      surfaces: closeProjectSurfaceSlot(state.surfaces, slot),
    },
    requiredLeave:
      slot === "side" && state.surfaces.side != null
        ? { action: "close", surface: "side" }
        : null,
  };
}

export function planSetProjectWorkbenchCanvasSelection(
  state: ProjectWorkbenchRouteState,
  canvasSelection: ProjectCanvasSelection | null
): ProjectRouteTransition<ProjectWorkbenchRouteState> {
  return {
    next: { ...state, canvasSelection },
    requiredLeave: null,
  };
}

export function planClearProjectWorkbenchCanvasFocus(
  state: ProjectWorkbenchRouteState
): ProjectRouteTransition<ProjectWorkbenchRouteState> {
  return {
    next: {
      canvasSelection: null,
      surfaces: {
        ...state.surfaces,
        main: null,
        side: null,
      },
    },
    requiredLeave:
      state.surfaces.side == null ? null : { action: "close", surface: "side" },
  };
}

export function planFocusProjectWorkbenchCanvasSelection(
  state: ProjectWorkbenchRouteState,
  canvasSelection: ProjectCanvasSelection
): ProjectRouteTransition<ProjectWorkbenchRouteState> {
  return {
    next: {
      canvasSelection,
      surfaces: {
        ...state.surfaces,
        main: null,
        side: null,
      },
    },
    requiredLeave:
      state.surfaces.side == null
        ? null
        : { action: "switch", surface: "side" },
  };
}

function resourceTargetStillValid(
  target: ProjectSurfaceTarget | null,
  targetExists: (target: ProjectSurfaceTarget) => boolean
) {
  return target == null || targetExists(target);
}

function sideEntryTargetStillValid(
  entry: ProjectSideSurfaceEntry,
  targetExists: (target: ProjectSurfaceTarget) => boolean
) {
  if (entry.kind === "settings") {
    return true;
  }
  return resourceTargetStillValid(
    projectSurfaceEntryTarget(entry),
    targetExists
  );
}

export function repairStaleProjectWorkbenchRouteState(
  state: ProjectWorkbenchRouteState,
  options: {
    canvasSelectionExists: (selection: ProjectCanvasSelection) => boolean;
    sideEntrySupported: (entry: ProjectSideSurfaceEntry) => boolean;
    targetExists: (target: ProjectSurfaceTarget) => boolean;
  }
): ProjectRouteTransition<ProjectWorkbenchRouteState> {
  let changed = false;
  let canvasSelection = state.canvasSelection;
  let side = state.surfaces.side;
  let main = state.surfaces.main;
  let drawer = state.surfaces.drawer;

  if (
    canvasSelection != null &&
    !options.canvasSelectionExists(canvasSelection)
  ) {
    canvasSelection = null;
    changed = true;
  }

  if (
    side != null &&
    !(
      options.sideEntrySupported(side) &&
      sideEntryTargetStillValid(side, options.targetExists)
    )
  ) {
    side = null;
    changed = true;
  }

  if (
    main != null &&
    !resourceTargetStillValid(
      projectSurfaceEntryTarget(main),
      options.targetExists
    )
  ) {
    main = null;
    changed = true;
  }

  if (
    drawer != null &&
    !resourceTargetStillValid(
      projectSurfaceEntryTarget(drawer),
      options.targetExists
    )
  ) {
    drawer = null;
    changed = true;
  }

  const selectionTarget = projectCanvasSelectionTarget(canvasSelection);
  if (selectionTarget != null && !options.targetExists(selectionTarget)) {
    canvasSelection = null;
    changed = true;
  }

  if (!changed) {
    return { next: state, requiredLeave: null };
  }

  return {
    next: {
      canvasSelection,
      surfaces: {
        drawer,
        main,
        side,
      },
    },
    requiredLeave: null,
  };
}
