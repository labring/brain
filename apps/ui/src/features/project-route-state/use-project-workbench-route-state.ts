"use client";

import { parseAsString, useQueryStates } from "nuqs";
import { useCallback, useEffect, useMemo, useRef } from "react";
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

type ProjectWorkbenchRouteQuery = Parameters<
  typeof parseProjectWorkbenchRouteState
>[0];

export function planInvalidProjectWorkbenchRouteRepair(options: {
  isSideEntrySupported: (entry: ProjectSideSurfaceEntry) => boolean;
  parsedState: ProjectWorkbenchRouteState;
  query: ProjectWorkbenchRouteQuery;
  state: ProjectWorkbenchRouteState;
}): { history: "replace"; next: ProjectWorkbenchRouteState } | null {
  const { isSideEntrySupported, parsedState, query, state } = options;
  if (query.selected != null && parsedState.canvasSelection == null) {
    return {
      history: "replace",
      next: { ...state, canvasSelection: null },
    };
  }
  if (query.side != null && parsedState.surfaces.side == null) {
    return {
      history: "replace",
      next: { ...state, surfaces: { ...state.surfaces, side: null } },
    };
  }
  if (
    query.side != null &&
    parsedState.surfaces.side != null &&
    !isSideEntrySupported(parsedState.surfaces.side)
  ) {
    return {
      history: "replace",
      next: { ...state, surfaces: { ...state.surfaces, side: null } },
    };
  }
  if (query.main != null && parsedState.surfaces.main == null) {
    return {
      history: "replace",
      next: { ...state, surfaces: { ...state.surfaces, main: null } },
    };
  }
  if (query.drawer != null && parsedState.surfaces.drawer == null) {
    return {
      history: "replace",
      next: { ...state, surfaces: { ...state.surfaces, drawer: null } },
    };
  }
  return null;
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
  const stateRef = useRef(state);
  stateRef.current = state;
  const queryRef = useRef(query);
  queryRef.current = query;

  const commit = useCallback(
    (next: ProjectWorkbenchRouteState, history: ProjectRouteHistoryMode) => {
      const nextQuery = serializeProjectWorkbenchRouteState(next);
      const currentQuery = queryRef.current;
      if (
        nextQuery.selected === currentQuery.selected &&
        nextQuery.side === currentQuery.side &&
        nextQuery.main === currentQuery.main &&
        nextQuery.drawer === currentQuery.drawer
      ) {
        return;
      }
      setQuery(nextQuery, { history }).catch(() => undefined);
    },
    [setQuery]
  );

  const applyTransition = useCallback(
    (
      transition: ProjectRouteTransition<ProjectWorkbenchRouteState>,
      history: ProjectRouteHistoryMode,
      onCommitted?: () => void
    ) => {
      const continueLeave = () => {
        commit(transition.next, history);
        onCommitted?.();
      };
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
    const repair = planInvalidProjectWorkbenchRouteRepair({
      isSideEntrySupported,
      parsedState,
      query,
      state,
    });
    if (repair != null) {
      commit(repair.next, repair.history);
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
    (intent: ProjectWorkbenchSurfaceIntent, onCommitted?: () => void) => {
      applyTransition(
        planOpenProjectWorkbenchSurface(stateRef.current, intent),
        "push",
        onCommitted
      );
    },
    [applyTransition]
  );

  const closeSurfaceSlot = useCallback(
    (slot: ProjectSurfaceSlot, onCommitted?: () => void) => {
      applyTransition(
        planCloseProjectWorkbenchSurfaceSlot(stateRef.current, slot),
        "push",
        onCommitted
      );
    },
    [applyTransition]
  );

  const openSide = useCallback(
    (
      entry: ProjectSideSurfaceEntry,
      canvasSelection?: ProjectCanvasSelection | null,
      onCommitted?: () => void
    ) => {
      openSurface({ canvasSelection, entry, slot: "side" }, onCommitted);
    },
    [openSurface]
  );

  const repairSide = useCallback(
    (entry: ProjectSideSurfaceEntry | null) => {
      const currentState = stateRef.current;
      commit(
        {
          ...currentState,
          surfaces: {
            ...currentState.surfaces,
            side: entry,
          },
        },
        "replace"
      );
    },
    [commit]
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

  const closeSide = useCallback(
    (onCommitted?: () => void) => {
      closeSurfaceSlot("side", onCommitted);
    },
    [closeSurfaceSlot]
  );

  const closeMain = useCallback(() => {
    closeSurfaceSlot("main");
  }, [closeSurfaceSlot]);

  const closeDrawer = useCallback(() => {
    closeSurfaceSlot("drawer");
  }, [closeSurfaceSlot]);

  const writeCanvasSelection = useCallback(
    (canvasSelection: ProjectCanvasSelection | null) => {
      applyTransition(
        planSetProjectWorkbenchCanvasSelection(
          stateRef.current,
          canvasSelection
        ),
        "push"
      );
    },
    [applyTransition]
  );

  const clearCanvasFocus = useCallback(() => {
    applyTransition(
      planClearProjectWorkbenchCanvasFocus(stateRef.current),
      "push"
    );
  }, [applyTransition]);

  const focusCanvasSelection = useCallback(
    (canvasSelection: ProjectCanvasSelection) => {
      applyTransition(
        planFocusProjectWorkbenchCanvasSelection(
          stateRef.current,
          canvasSelection
        ),
        "push"
      );
    },
    [applyTransition]
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
    repairSide,
    side: state.surfaces.side,
    state,
    surfaces: state.surfaces,
    writeCanvasSelection,
  };
}
