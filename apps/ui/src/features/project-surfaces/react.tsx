"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
} from "react";
import {
  createProjectSidePaneAssistantRouter,
  type ProjectSidePaneAssistantRouter,
  type ProjectSidePaneAssistantSurface,
} from "./assistant-router";

const ProjectSidePaneContext =
  createContext<ProjectSidePaneAssistantRouter | null>(null);

export function ProjectSidePaneProvider({ children }: { children: ReactNode }) {
  const router = useMemo(() => createProjectSidePaneAssistantRouter(), []);

  return (
    <ProjectSidePaneContext.Provider value={router}>
      {children}
    </ProjectSidePaneContext.Provider>
  );
}

export function useProjectSidePaneAssistantRouter(): ProjectSidePaneAssistantRouter {
  const router = useContext(ProjectSidePaneContext);
  if (router == null) {
    throw new Error(
      "useProjectSidePaneAssistantRouter must be used within ProjectSidePaneProvider"
    );
  }
  return router;
}

export function useProjectSidePaneSurface(
  surface: ProjectSidePaneAssistantSurface | null
) {
  const router = useProjectSidePaneAssistantRouter();

  useEffect(() => {
    if (surface == null) {
      return;
    }
    return router.registerSurface(surface);
  }, [router, surface]);
}
