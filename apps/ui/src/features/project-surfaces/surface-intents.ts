import type {
  ProjectSideSurfaceEntry,
  ProjectSurfaceIntent,
} from "@/features/project-surfaces/surface-state";
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
  options?: { projectId?: string }
): ProjectSurfaceIntent | null {
  if (intent.type === "apEvents") {
    return {
      entry: { kind: "apEvents", target: intent.target },
      slot: "side",
    };
  }
  if (intent.type === "apHistory") {
    return {
      entry: { kind: "apHistory", target: intent.target },
      slot: "side",
    };
  }
  if (intent.type === "apMetrics" || intent.type === "metrics") {
    if (intent.target.kind === "AP") {
      return {
        entry: { kind: "apMetrics", target: intent.target },
        slot: "side",
      };
    }
    return {
      entry: { kind: "dbMetrics", target: intent.target },
      slot: "side",
    };
  }
  if (intent.type === "apSettings") {
    return {
      entry: { kind: "apSettings", target: intent.target },
      slot: "side",
    };
  }
  if (intent.type === "apTerminal") {
    return {
      entry: { kind: "apTerminal", target: intent.target },
      slot: "drawer",
    };
  }
  if (intent.type === "dbAccess") {
    return {
      entry: {
        focusPolicy: "keepSideVisible",
        kind: "dbAccess",
        target: intent.target,
      },
      slot: "main",
    };
  }
  if (intent.type === "dbMetrics") {
    return {
      entry: { kind: "dbMetrics", target: intent.target },
      slot: "side",
    };
  }
  if (intent.type === "dbSettings") {
    return {
      entry: { kind: "dbSettings", target: intent.target },
      slot: "side",
    };
  }
  if (intent.type === "dbTerminal") {
    return {
      entry: { kind: "dbTerminal", target: intent.target },
      slot: "drawer",
    };
  }
  if (intent.type === "entrypointPublicAddresses") {
    return {
      entry: { kind: "publicAddresses", target: intent.target },
      slot: "side",
    };
  }
  if (intent.type === "logs") {
    return {
      entry: {
        focusPolicy: "keepSideVisible",
        kind: "resourceLogs",
        target: intent.target,
      },
      slot: "main",
    };
  }
  const uid = options?.projectId?.trim() ?? "";
  if (uid === "") {
    return null;
  }
  if (intent.type === "database") {
    return {
      entry: {
        kind: "databaseDeployment",
        projectId: uid,
      },
      slot: "side",
    };
  }
  if (intent.type === "docker") {
    return {
      entry: {
        kind: "dockerDeployment",
        projectId: uid,
      },
      slot: "side",
    };
  }
  if (intent.type !== "github") {
    return null;
  }
  return {
    entry: {
      kind: "githubDeployment",
      projectId: uid,
    },
    slot: "side",
  };
}
