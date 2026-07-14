import {
  parseProjectSideSurfaceEntry,
  serializeProjectSideSurfaceEntry,
} from "@/features/panes/url-codec";
import type { ProjectSideRouteState } from "./side-state";

export const PROJECT_SIDE_QUERY_KEY = "side" as const;

export function parseProjectSideRouteState(input: {
  side?: string | null;
}): ProjectSideRouteState {
  return {
    side: parseProjectSideSurfaceEntry(input.side),
  };
}

export function serializeProjectSideRouteState(
  state: ProjectSideRouteState
): Record<typeof PROJECT_SIDE_QUERY_KEY, string | null> {
  return {
    [PROJECT_SIDE_QUERY_KEY]: serializeProjectSideSurfaceEntry(state.side),
  };
}
