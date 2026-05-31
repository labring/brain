export interface ProjectSidePaneAssistantIntent {
  type: "database" | "docker" | "github";
}

export type ProjectSidePaneIntentResult =
  | { status: "handled" }
  | { status: "ignored" };

export interface ProjectSidePaneSurface {
  id: string;
  openAssistantIntent: (
    intent: ProjectSidePaneAssistantIntent
  ) => Promise<ProjectSidePaneIntentResult> | ProjectSidePaneIntentResult;
}

export interface ProjectSidePaneController {
  openAssistantIntent: (
    intent: ProjectSidePaneAssistantIntent
  ) => Promise<ProjectSidePaneIntentResult>;
  registerSurface: (surface: ProjectSidePaneSurface) => () => void;
}

export function createProjectSidePaneController(): ProjectSidePaneController {
  let currentSurface: ProjectSidePaneSurface | null = null;

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
