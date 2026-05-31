import type { ProjectCreationPaneEntryMode } from "@/components/project-creation-pane-state";
import type {
  ProjectApBoundEntryPointTarget,
  ProjectApTarget,
  ProjectDbTarget,
  ProjectResourceTarget,
  ProjectSurfaceTarget,
} from "./target-identity";

export type ProjectSurfaceSlot = "drawer" | "main" | "side";
export type ProjectMainSurfaceFocusPolicy = "focusMain" | "keepSideVisible";

export type ProjectCanvasSelection =
  | { kind: "edge"; edgeId: string }
  | { kind: "resource"; target: ProjectResourceTarget }
  | { kind: "publicAddresses"; target: ProjectApBoundEntryPointTarget };

export type ProjectSideSurfaceEntry =
  | { kind: "apEvents"; target: ProjectApTarget }
  | { kind: "apHistory"; target: ProjectApTarget }
  | { kind: "apMetrics"; target: ProjectApTarget }
  | { kind: "apSettings"; target: ProjectApTarget }
  | { kind: "databaseDeployment"; projectUid: string }
  | { kind: "dbMetrics"; target: ProjectDbTarget }
  | { kind: "dbSettings"; target: ProjectDbTarget }
  | { kind: "dockerDeployment"; projectUid: string }
  | { kind: "githubDeployment"; projectUid: string }
  | { kind: "projectCreation"; entryMode: ProjectCreationPaneEntryMode }
  | { kind: "publicAddresses"; target: ProjectApBoundEntryPointTarget };

export type ProjectMainSurfaceEntry =
  | {
      focusPolicy?: ProjectMainSurfaceFocusPolicy;
      kind: "dbAccess";
      target: ProjectDbTarget;
    }
  | {
      focusPolicy?: ProjectMainSurfaceFocusPolicy;
      kind: "resourceLogs";
      target: ProjectResourceTarget;
    };

export type ProjectDrawerSurfaceEntry =
  | { kind: "apTerminal"; target: ProjectApTarget }
  | { kind: "dbConsole"; target: ProjectDbTarget };

export interface ProjectSurfaceState {
  drawer: ProjectDrawerSurfaceEntry | null;
  main: ProjectMainSurfaceEntry | null;
  selected: ProjectCanvasSelection | null;
  side: ProjectSideSurfaceEntry | null;
}

export const EMPTY_PROJECT_SURFACE_STATE: ProjectSurfaceState = {
  drawer: null,
  main: null,
  selected: null,
  side: null,
};

export type ProjectSurfaceIntent =
  | {
      entry: ProjectSideSurfaceEntry;
      select?: ProjectCanvasSelection | null;
      slot: "side";
    }
  | {
      entry: ProjectMainSurfaceEntry;
      select?: ProjectCanvasSelection | null;
      slot: "main";
    }
  | {
      entry: ProjectDrawerSurfaceEntry;
      select?: ProjectCanvasSelection | null;
      slot: "drawer";
    };

export function projectSurfaceEntryTarget(
  entry:
    | ProjectDrawerSurfaceEntry
    | ProjectMainSurfaceEntry
    | ProjectSideSurfaceEntry
    | null
    | undefined
): ProjectSurfaceTarget | null {
  if (entry == null) {
    return null;
  }
  if ("target" in entry) {
    return entry.target;
  }
  return null;
}

export function projectCanvasSelectionTarget(
  selection: ProjectCanvasSelection | null | undefined
): ProjectSurfaceTarget | null {
  if (selection == null || selection.kind === "edge") {
    return null;
  }
  return selection.target;
}

export function mainSurfaceFocusPolicy(
  entry: ProjectMainSurfaceEntry | null | undefined
): ProjectMainSurfaceFocusPolicy {
  return entry?.focusPolicy ?? "focusMain";
}

export function projectSideSurfaceVisible(
  state: Pick<ProjectSurfaceState, "main" | "side">
): boolean {
  if (state.side == null) {
    return false;
  }
  return (
    state.main == null ||
    mainSurfaceFocusPolicy(state.main) === "keepSideVisible"
  );
}
