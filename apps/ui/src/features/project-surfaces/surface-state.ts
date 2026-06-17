import type { ProjectCreationPaneEntryMode } from "@/features/project-creation/project-creation-pane-state";
import type {
  ProjectApTarget,
  ProjectDbTarget,
  ProjectResourceTarget,
  ProjectSurfaceTarget,
  SettingsOwnerTarget,
} from "./target-identity";

export type ProjectSurfaceSlot = "drawer" | "main" | "side";
export type ProjectMainSurfaceFocusPolicy = "focusMain" | "keepSideVisible";

export type ProjectResourceSidePaneEntry =
  | { kind: "apEvents"; target: ProjectApTarget }
  | { kind: "apHistory"; target: ProjectApTarget }
  | { kind: "apMetrics"; target: ProjectApTarget }
  | { kind: "dbMetrics"; target: ProjectDbTarget }
  | {
      kind: "settings";
      target: SettingsOwnerTarget;
      view?: string;
    };

export type ProjectGlobalSidePaneEntry =
  | { kind: "databaseDeployment"; projectId: string }
  | { kind: "deploymentTaskTimeline"; projectId: string; taskId: string }
  | { kind: "dockerDeployment"; projectId: string }
  | { kind: "githubDeployment"; projectId: string }
  | { kind: "projectCreation"; entryMode: ProjectCreationPaneEntryMode }
  | { kind: "skillsWorkflow" }
  | { kind: "templateDeployment"; projectId: string };

export type ProjectSideSurfaceEntry =
  | ProjectGlobalSidePaneEntry
  | ProjectResourceSidePaneEntry;

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
  | { kind: "dbTerminal"; target: ProjectDbTarget };

export interface ProjectSurfaceState {
  drawer: ProjectDrawerSurfaceEntry | null;
  main: ProjectMainSurfaceEntry | null;
  side: ProjectSideSurfaceEntry | null;
}

export const EMPTY_PROJECT_SURFACE_STATE: ProjectSurfaceState = {
  drawer: null,
  main: null,
  side: null,
};

export type ProjectSurfaceIntent =
  | {
      entry: ProjectSideSurfaceEntry;
      slot: "side";
    }
  | {
      entry: ProjectMainSurfaceEntry;
      slot: "main";
    }
  | {
      entry: ProjectDrawerSurfaceEntry;
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
