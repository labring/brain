import {
  parseProjectTarget,
  serializeProjectTarget,
} from "@/features/project-surfaces/target-identity";
import {
  parseProjectDrawerSurfaceEntry,
  parseProjectMainSurfaceEntry,
  parseProjectSideSurfaceEntry,
  serializeProjectDrawerSurfaceEntry,
  serializeProjectMainSurfaceEntry,
  serializeProjectSideSurfaceEntry,
} from "@/features/project-surfaces/url-codec";
import type { ProjectCanvasSelection } from "./canvas-selection";
import { PROJECT_SIDE_QUERY_KEY } from "./side-url-codec";
import type { ProjectWorkbenchRouteState } from "./workbench-state";

export const PROJECT_SELECTED_QUERY_KEY = "selected" as const;
export const PROJECT_MAIN_QUERY_KEY = "main" as const;
export const PROJECT_DRAWER_QUERY_KEY = "drawer" as const;

function encodePart(value: string): string {
  return encodeURIComponent(value);
}

function decodePart(value: string | undefined): string | null {
  if (value == null) {
    return null;
  }
  try {
    const decoded = decodeURIComponent(value).trim();
    return decoded === "" ? null : decoded;
  } catch {
    return null;
  }
}

function split(value: string | null | undefined): string[] | null {
  const parts = value?.split(":") ?? null;
  return parts?.every((part) => part !== "") ? parts : null;
}

export function serializeProjectCanvasSelection(
  selection: ProjectCanvasSelection | null | undefined
): string | null {
  if (selection == null) {
    return null;
  }
  if (selection.kind === "edge") {
    return `edge:${encodePart(selection.edgeId)}`;
  }
  return serializeProjectTarget(selection.target);
}

export function parseProjectCanvasSelection(
  value: string | null | undefined
): ProjectCanvasSelection | null {
  const parts = split(value);
  if (parts == null) {
    return null;
  }
  if (parts[0] === "edge") {
    if (parts.length !== 2) {
      return null;
    }
    const edgeId = decodePart(parts[1]);
    return edgeId == null ? null : { edgeId, kind: "edge" };
  }

  const target = parseProjectTarget(value);
  if (target?.kind === "AP" || target?.kind === "DB") {
    return { kind: "resource", target };
  }
  if (target?.kind === "EntryPoint") {
    return { kind: "publicAddresses", target };
  }
  return null;
}

export function parseProjectWorkbenchRouteState(input: {
  drawer?: string | null;
  main?: string | null;
  selected?: string | null;
  side?: string | null;
}): ProjectWorkbenchRouteState {
  return {
    canvasSelection: parseProjectCanvasSelection(input.selected),
    surfaces: {
      drawer: parseProjectDrawerSurfaceEntry(input.drawer),
      main: parseProjectMainSurfaceEntry(input.main),
      side: parseProjectSideSurfaceEntry(input.side),
    },
  };
}

export function serializeProjectWorkbenchRouteState(
  state: ProjectWorkbenchRouteState
): Record<
  | typeof PROJECT_DRAWER_QUERY_KEY
  | typeof PROJECT_MAIN_QUERY_KEY
  | typeof PROJECT_SELECTED_QUERY_KEY
  | typeof PROJECT_SIDE_QUERY_KEY,
  string | null
> {
  return {
    [PROJECT_SELECTED_QUERY_KEY]: serializeProjectCanvasSelection(
      state.canvasSelection
    ),
    [PROJECT_SIDE_QUERY_KEY]: serializeProjectSideSurfaceEntry(
      state.surfaces.side
    ),
    [PROJECT_MAIN_QUERY_KEY]: serializeProjectMainSurfaceEntry(
      state.surfaces.main
    ),
    [PROJECT_DRAWER_QUERY_KEY]: serializeProjectDrawerSurfaceEntry(
      state.surfaces.drawer
    ),
  };
}
