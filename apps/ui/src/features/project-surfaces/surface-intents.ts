import type { ProjectSideSurfaceEntry } from "@/features/project-surfaces/surface-state";
import type { ProjectSidePaneAssistantIntent } from "./controller";

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
  { projectUid }: { projectUid: string }
): ProjectSidePaneEntry | null {
  const uid = projectUid.trim();
  if (uid === "") {
    return null;
  }
  if (intent.type === "database") {
    return {
      kind: "databaseDeployment",
      projectUid: uid,
    };
  }
  if (intent.type === "docker") {
    return {
      kind: "dockerDeployment",
      projectUid: uid,
    };
  }
  if (intent.type !== "github") {
    return null;
  }
  return {
    kind: "githubDeployment",
    projectUid: uid,
  };
}
