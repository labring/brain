"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useState,
} from "react";

import type {
  ProjectExplorerActions,
  ProjectExplorerStates,
  ProjectExplorerValue,
} from "./project-explorer.types";

export const ProjectExplorerContext =
  createContext<ProjectExplorerValue | null>(null);

export function useProjectExplorer(): ProjectExplorerValue {
  const value = useContext(ProjectExplorerContext);
  if (!value) {
    throw new Error(
      "ProjectExplorer: useProjectExplorer must be used within ProjectExplorer.Root"
    );
  }
  return value;
}

export function ProjectExplorerRoot({
  actions = {},
  children,
  states,
}: {
  actions?: ProjectExplorerActions;
  children?: ReactNode;
  states: ProjectExplorerStates;
}) {
  const [searchQuery, setSearchQuery] = useState("");

  const value = useMemo(
    (): ProjectExplorerValue => ({
      actions,
      searchQuery,
      setSearchQuery,
      states,
    }),
    [actions, searchQuery, states]
  );

  return (
    <ProjectExplorerContext.Provider value={value}>
      {children}
    </ProjectExplorerContext.Provider>
  );
}
