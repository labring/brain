"use client";

import { parseAsString, useQueryStates } from "nuqs";
import { useCallback, useEffect, useMemo } from "react";
import type { ProjectSideSurfaceEntry } from "@/features/panes/surface-state";
import {
  type ProjectRouteLeaveRequirement,
  type ProjectRouteTransition,
  planCloseProjectSideRouteState,
  planOpenProjectSideRouteState,
  repairUnsupportedProjectSideRouteState,
} from "./side-reducer";
import type { ProjectSideRouteState } from "./side-state";
import { EMPTY_PROJECT_SIDE_ROUTE_STATE } from "./side-state";
import {
  PROJECT_SIDE_QUERY_KEY,
  parseProjectSideRouteState,
  serializeProjectSideRouteState,
} from "./side-url-codec";

export type ProjectRouteHistoryMode = "push" | "replace";
export type ProjectSidePaneLeaveAction = "close" | "switch";
export type ProjectSidePaneLeaveRequest = (
  action: ProjectSidePaneLeaveAction,
  continueLeave: () => void
) => void;

function leaveActionForRequirement(
  requirement: Exclude<ProjectRouteLeaveRequirement, null>
): ProjectSidePaneLeaveAction {
  return requirement.action === "close" ? "close" : "switch";
}

const anySideEntrySupported = () => true;

export function useProjectSideRouteState(options?: {
  isSideEntrySupported?: (entry: ProjectSideSurfaceEntry) => boolean;
  requestSidePaneLeave?: ProjectSidePaneLeaveRequest;
}) {
  const isSideEntrySupported =
    options?.isSideEntrySupported ?? anySideEntrySupported;
  const requestSidePaneLeave = options?.requestSidePaneLeave;
  const [query, setQuery] = useQueryStates({
    [PROJECT_SIDE_QUERY_KEY]: parseAsString,
  });

  const parsedState = useMemo(() => parseProjectSideRouteState(query), [query]);
  const state = useMemo<ProjectSideRouteState>(() => {
    if (parsedState.side != null && !isSideEntrySupported(parsedState.side)) {
      return EMPTY_PROJECT_SIDE_ROUTE_STATE;
    }
    return parsedState;
  }, [isSideEntrySupported, parsedState]);

  const commit = useCallback(
    (next: ProjectSideRouteState, history: ProjectRouteHistoryMode) => {
      setQuery(serializeProjectSideRouteState(next), { history }).catch(
        () => undefined
      );
    },
    [setQuery]
  );

  const applyTransition = useCallback(
    (
      transition: ProjectRouteTransition<ProjectSideRouteState>,
      history: ProjectRouteHistoryMode
    ) => {
      const continueLeave = () => commit(transition.next, history);
      if (transition.requiredLeave == null || requestSidePaneLeave == null) {
        continueLeave();
        return;
      }
      requestSidePaneLeave(
        leaveActionForRequirement(transition.requiredLeave),
        continueLeave
      );
    },
    [commit, requestSidePaneLeave]
  );

  useEffect(() => {
    const repair = repairUnsupportedProjectSideRouteState(
      parsedState,
      isSideEntrySupported
    );
    if (query.side != null && parsedState.side == null) {
      commit(EMPTY_PROJECT_SIDE_ROUTE_STATE, "replace");
      return;
    }
    if (repair.next !== parsedState) {
      commit(repair.next, "replace");
    }
  }, [commit, isSideEntrySupported, parsedState, query.side]);

  const openSide = useCallback(
    (
      entry: ProjectSideSurfaceEntry,
      history: ProjectRouteHistoryMode = "push"
    ) => {
      applyTransition(planOpenProjectSideRouteState(state, entry), history);
    },
    [applyTransition, state]
  );

  const closeSide = useCallback(
    (history: ProjectRouteHistoryMode = "push") => {
      applyTransition(planCloseProjectSideRouteState(state), history);
    },
    [applyTransition, state]
  );

  return {
    closeSide,
    openSide,
    side: state.side,
    state,
  };
}
