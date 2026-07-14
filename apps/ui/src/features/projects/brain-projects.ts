import type { ProjectExplorerProject } from "@/features/projects/explorer/project-explorer";

import type { VisualTone } from "./project-aggregate-status";

export interface BrainProject {
  createdAt: string;
  description: string;
  displayName: string;
  id: string;
  namespace: string;
  updatedAt: string;
}

export interface BrainProjectsResponse {
  projects: BrainProject[];
}

export interface BrainProjectResponse {
  project: BrainProject;
}

export function normalizeProjectDisplayName(name: string): string {
  return name.trim().toLowerCase();
}

export function isProjectDisplayNameTaken(
  projects: readonly ProjectExplorerProject[],
  displayName: string,
  ignoreProjectId?: string
): boolean {
  const normalized = normalizeProjectDisplayName(displayName);
  if (normalized === "") {
    return false;
  }
  return projects.some(
    (project) =>
      project.id !== ignoreProjectId &&
      normalizeProjectDisplayName(project.name) === normalized
  );
}

export function brainProjectsToExplorerProjects(
  data: BrainProjectsResponse | undefined,
  statusByProjectId?: ReadonlyMap<string, VisualTone>
): ProjectExplorerProject[] {
  return (data?.projects ?? []).map((project) => {
    const status = statusByProjectId?.get(project.id);
    return {
      createdAt: project.createdAt,
      description: project.description,
      id: project.id,
      name: project.displayName,
      resourceName: project.id,
      ...(status === undefined ? {} : { status }),
    };
  });
}
