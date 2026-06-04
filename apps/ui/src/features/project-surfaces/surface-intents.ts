import type { ProjectSideSurfaceEntry } from "@/features/project-surfaces/surface-state";
import type { ProjectSidePaneAssistantIntent } from "./assistant-router";

export type ProjectSidePaneEntry = Extract<
  ProjectSideSurfaceEntry,
  | { kind: "databaseDeployment" }
  | { kind: "dockerDeployment" }
  | { kind: "githubDeployment" }
  | { kind: "projectCreation" }
>;

export function projectListEntryForAssistantIntent(
  intent: ProjectSidePaneAssistantIntent
): ProjectSidePaneEntry | null {
  if (intent.type === "github") {
    return {
      entryMode: "githubDirect",
      kind: "projectCreation",
    };
  }
  if (intent.type === "database") {
    return {
      entryMode: "databaseDirect",
      kind: "projectCreation",
    };
  }
  if (intent.type === "docker") {
    return {
      entryMode: "dockerDirect",
      kind: "projectCreation",
    };
  }
  return null;
}

export function projectCanvasEntryForAssistantIntent(
  intent: ProjectSidePaneAssistantIntent,
  { projectId }: { projectId: string }
): ProjectSidePaneEntry | null {
  const uid = projectId.trim();
  if (uid === "") {
    return null;
  }
  if (intent.type === "database") {
    return {
      kind: "databaseDeployment",
      projectId: uid,
    };
  }
  if (intent.type === "docker") {
    return {
      kind: "dockerDeployment",
      projectId: uid,
    };
  }
  if (intent.type !== "github") {
    return null;
  }
  return {
    kind: "githubDeployment",
    projectId: uid,
  };
}
