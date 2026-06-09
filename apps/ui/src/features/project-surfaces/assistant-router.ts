import type {
  ProjectApBoundEntryPointTarget,
  ProjectApTarget,
  ProjectDbTarget,
  ProjectResourceTarget,
} from "./target-identity";

export type ProjectSidePaneAssistantIntent =
  | { type: "database" | "docker" | "github" | "skills" | "template" }
  | { target: ProjectApTarget; type: "apEvents" | "apHistory" | "apMetrics" }
  | { target: ProjectApTarget; type: "apSettings" | "apTerminal" }
  | { target: ProjectDbTarget; type: "dbAccess" | "dbMetrics" | "dbSettings" }
  | { target: ProjectDbTarget; type: "dbTerminal" }
  | { target: ProjectResourceTarget; type: "logs" | "metrics" }
  | {
      target: ProjectApBoundEntryPointTarget;
      type: "entrypointPublicAddresses";
    };

export type ProjectSidePaneIntentResult =
  | { status: "handled" }
  | { status: "ignored" };

export interface ProjectSidePaneAssistantSurface {
  id: string;
  openAssistantIntent: (
    intent: ProjectSidePaneAssistantIntent
  ) => Promise<ProjectSidePaneIntentResult> | ProjectSidePaneIntentResult;
}

export interface ProjectSidePaneAssistantRouter {
  openAssistantIntent: (
    intent: ProjectSidePaneAssistantIntent
  ) => Promise<ProjectSidePaneIntentResult>;
  registerSurface: (surface: ProjectSidePaneAssistantSurface) => () => void;
}

export function createProjectSidePaneAssistantRouter(): ProjectSidePaneAssistantRouter {
  let currentSurface: ProjectSidePaneAssistantSurface | null = null;

  return {
    openAssistantIntent(intent) {
      if (currentSurface == null) {
        return Promise.resolve({ status: "ignored" });
      }
      return Promise.resolve(currentSurface.openAssistantIntent(intent));
    },
    registerSurface(surface) {
      currentSurface = surface;
      return () => {
        if (currentSurface?.id === surface.id) {
          currentSurface = null;
        }
      };
    },
  };
}
