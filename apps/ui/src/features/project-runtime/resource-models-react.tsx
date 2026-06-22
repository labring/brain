"use client";

import { createContext, type ReactNode, useContext } from "react";

import {
  type ProjectRuntimeNodeModel,
  type ProjectRuntimeNodeModels,
  projectRuntimeShellLookupFromNodeData,
  selectProjectRuntimeNodeModel,
} from "./resource-models";

const ProjectRuntimeNodeModelsContext =
  createContext<ProjectRuntimeNodeModels | null>(null);

export function ProjectRuntimeNodeModelsProvider({
  children,
  models,
}: {
  children: ReactNode;
  models: ProjectRuntimeNodeModels;
}) {
  return (
    <ProjectRuntimeNodeModelsContext.Provider value={models}>
      {children}
    </ProjectRuntimeNodeModelsContext.Provider>
  );
}

export function useProjectRuntimeNodeModel<
  TModel extends ProjectRuntimeNodeModel,
>(data: unknown): TModel | undefined {
  const models = useContext(ProjectRuntimeNodeModelsContext);
  if (models === null) {
    return undefined;
  }
  const lookup = projectRuntimeShellLookupFromNodeData(data);
  return selectProjectRuntimeNodeModel(models, lookup) as TModel | undefined;
}
