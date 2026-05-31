"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
} from "react";
import {
  createProjectSidePaneController,
  type ProjectSidePaneController,
  type ProjectSidePaneSurface,
} from "./controller";

const ProjectSidePaneContext = createContext<ProjectSidePaneController | null>(
  null
);

export function ProjectSidePaneProvider({ children }: { children: ReactNode }) {
  const controller = useMemo(() => createProjectSidePaneController(), []);

  return (
    <ProjectSidePaneContext.Provider value={controller}>
      {children}
    </ProjectSidePaneContext.Provider>
  );
}

export function useProjectSidePaneController(): ProjectSidePaneController {
  const controller = useContext(ProjectSidePaneContext);
  if (controller == null) {
    throw new Error(
      "useProjectSidePaneController must be used within ProjectSidePaneProvider"
    );
  }
  return controller;
}

export function useProjectSidePaneSurface(
  surface: ProjectSidePaneSurface | null
) {
  const controller = useProjectSidePaneController();

  useEffect(() => {
    if (surface == null) {
      return;
    }
    return controller.registerSurface(surface);
  }, [controller, surface]);
}
