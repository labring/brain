"use client";

import { parseAsString, useQueryStates } from "nuqs";
import { useCallback, useEffect, useMemo } from "react";
import type {
  ProjectDrawerSurfaceEntry,
  ProjectMainSurfaceEntry,
  ProjectSideSurfaceEntry,
  ProjectSurfaceSlot,
} from "@/features/project-surfaces/surface-state";
import type { ProjectSurfaceTarget } from "@/features/project-surfaces/target-identity";
import type { ProjectCanvasSelection } from "./canvas-selection";
import type { ProjectRouteTransition } from "./side-reducer";
import { PROJECT_SIDE_QUERY_KEY } from "./side-url-codec";
import type {
  ProjectRouteHistoryMode,
  ProjectSidePaneLeaveRequest,
} from "./use-project-side-route-state";
import {
  type ProjectWorkbenchSurfaceIntent,
  planClearProjectWorkbenchCanvasFocus,
  planCloseProjectWorkbenchSurfaceSlot,
  planFocusProjectWorkbenchCanvasSelection,
  planOpenProjectWorkbenchSurface,
  planSetProjectWorkbenchCanvasSelection,
  repairStaleProjectWorkbenchRouteState,
} from "./workbench-reducer";
import type { ProjectWorkbenchRouteState } from "./workbench-state";
import {
  PROJECT_DRAWER_QUERY_KEY,
  PROJECT_MAIN_QUERY_KEY,
  PROJECT_SELECTED_QUERY_KEY,
  parseProjectWorkbenchRouteState,
  serializeProjectWorkbenchRouteState,
} from "./workbench-url-codec";

function supportedWorkbenchState(
  state: ProjectWorkbenchRouteState,
  isSideEntrySupported: (entry: ProjectSideSurfaceEntry) => boolean
): ProjectWorkbenchRouteState {
  if (
    state.surfaces.side == null ||
    isSideEntrySupported(state.surfaces.side)
  ) {
    return state;
  }
  return {
    ...state,
    surfaces: {
      ...state.surfaces,
      side: null,
    },
  };
}

export function useProjectWorkbenchRouteState(options: {
  canvasSelectionExists: (selection: ProjectCanvasSelection) => boolean;
  isSideEntrySupported: (entry: ProjectSideSurfaceEntry) => boolean;
  requestSidePaneLeave?: ProjectSidePaneLeaveRequest;
  selectionReady: boolean;
  targetExists: (target: ProjectSurfaceTarget) => boolean;
}) {
  const {
    canvasSelectionExists,
    isSideEntrySupported,
    requestSidePaneLeave,
    selectionReady,
    targetExists,
  } = options;
  const [query, setQuery] = useQueryStates({
    [PROJECT_SELECTED_QUERY_KEY]: parseAsString,
    [PROJECT_SIDE_QUERY_KEY]: parseAsString,
    [PROJECT_MAIN_QUERY_KEY]: parseAsString,
    [PROJECT_DRAWER_QUERY_KEY]: parseAsString,
  });

  const parsedState = useMemo(
    () => parseProjectWorkbenchRouteState(query),
    [query]
  );
  const state = useMemo(
    () => supportedWorkbenchState(parsedState, isSideEntrySupported),
    [isSideEntrySupported, parsedState]
  );

  const commit = useCallback(
    (next: ProjectWorkbenchRouteState, history: ProjectRouteHistoryMode) => {
      setQuery(serializeProjectWorkbenchRouteState(next), { history }).catch(
        () => undefined
      );
    },
    [setQuery]
  );

  const applyTransition = useCallback(
    (
      transition: ProjectRouteTransition<ProjectWorkbenchRouteState>,
      history: ProjectRouteHistoryMode
    ) => {
      const continueLeave = () => commit(transition.next, history);
      if (transition.requiredLeave == null || requestSidePaneLeave == null) {
        continueLeave();
        return;
      }
      requestSidePaneLeave(
        transition.requiredLeave.action === "close" ? "close" : "switch",
        continueLeave
      );
    },
    [commit, requestSidePaneLeave]
  );

  useEffect(() => {
    if (query.selected != null && parsedState.canvasSelection == null) {
      commit(
        {
          ...state,
          canvasSelection: null,
        },
        "replace"
      );
      return;
    }
    if (query.side != null && parsedState.surfaces.side == null) {
      commit(
        {
          ...state,
          surfaces: { ...state.surfaces, side: null },
        },
        "replace"
      );
      return;
    }
    if (
      query.side != null &&
      parsedState.surfaces.side != null &&
      !isSideEntrySupported(parsedState.surfaces.side)
    ) {
      commit(
        {
          ...state,
          surfaces: { ...state.surfaces, side: null },
        },
        "replace"
      );
      return;
    }
    if (query.main != null && parsedState.surfaces.main == null) {
      commit(
        {
          ...state,
          surfaces: { ...state.surfaces, main: null },
        },
        "replace"
      );
      return;
    }
    if (query.drawer != null && parsedState.surfaces.drawer == null) {
      commit(
        {
          ...state,
          surfaces: { ...state.surfaces, drawer: null },
        },
        "replace"
      );
    }
  }, [commit, isSideEntrySupported, parsedState, query, state]);

  useEffect(() => {
    if (!selectionReady) {
      return;
    }
    const repair = repairStaleProjectWorkbenchRouteState(state, {
      canvasSelectionExists,
      sideEntrySupported: isSideEntrySupported,
      targetExists,
    });
    if (repair.next !== state) {
      commit(repair.next, "replace");
    }
  }, [
    canvasSelectionExists,
    commit,
    isSideEntrySupported,
    selectionReady,
    state,
    targetExists,
  ]);

  const openSurface = useCallback(
    (intent: ProjectWorkbenchSurfaceIntent) => {
      applyTransition(planOpenProjectWorkbenchSurface(state, intent), "push");
    },
    [applyTransition, state]
  );

  const closeSurfaceSlot = useCallback(
    (slot: ProjectSurfaceSlot) => {
      applyTransition(
        planCloseProjectWorkbenchSurfaceSlot(state, slot),
        "push"
      );
    },
    [applyTransition, state]
  );

  const openSide = useCallback(
    (
      entry: ProjectSideSurfaceEntry,
      canvasSelection?: ProjectCanvasSelection | null
    ) => {
      openSurface({ canvasSelection, entry, slot: "side" });
    },
    [openSurface]
  );

  const openMain = useCallback(
    (
      entry: ProjectMainSurfaceEntry,
      canvasSelection?: ProjectCanvasSelection | null
    ) => {
      openSurface({ canvasSelection, entry, slot: "main" });
    },
    [openSurface]
  );

  const openDrawer = useCallback(
    (
      entry: ProjectDrawerSurfaceEntry,
      canvasSelection?: ProjectCanvasSelection | null
    ) => {
      openSurface({ canvasSelection, entry, slot: "drawer" });
    },
    [openSurface]
  );

  const closeSide = useCallback(() => {
    closeSurfaceSlot("side");
  }, [closeSurfaceSlot]);

  const closeMain = useCallback(() => {
    closeSurfaceSlot("main");
  }, [closeSurfaceSlot]);

  const closeDrawer = useCallback(() => {
    closeSurfaceSlot("drawer");
  }, [closeSurfaceSlot]);

  const writeCanvasSelection = useCallback(
    (canvasSelection: ProjectCanvasSelection | null) => {
      applyTransition(
        planSetProjectWorkbenchCanvasSelection(state, canvasSelection),
        "push"
      );
    },
    [applyTransition, state]
  );

  const clearCanvasFocus = useCallback(() => {
    applyTransition(planClearProjectWorkbenchCanvasFocus(state), "push");
  }, [applyTransition, state]);

  const focusCanvasSelection = useCallback(
    (canvasSelection: ProjectCanvasSelection) => {
      applyTransition(
        planFocusProjectWorkbenchCanvasSelection(state, canvasSelection),
        "push"
      );
    },
    [applyTransition, state]
  );

  return {
    canvasSelection: state.canvasSelection,
    clearCanvasFocus,
    closeDrawer,
    closeMain,
    closeSide,
    drawer: state.surfaces.drawer,
    focusCanvasSelection,
    main: state.surfaces.main,
    openDrawer,
    openMain,
    openSide,
    side: state.surfaces.side,
    state,
    surfaces: state.surfaces,
    writeCanvasSelection,
  };
}
