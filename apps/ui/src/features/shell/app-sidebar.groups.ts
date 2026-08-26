import type { ProjectExplorerProject } from "@/features/projects/explorer/project-explorer.types";
import { MAX_PINNED_PROJECTS } from "@/features/projects/pinned-projects";

export interface AppSidebarProjectGroups {
  pinned: ProjectExplorerProject[];
  projects: ProjectExplorerProject[];
}

export function createAppSidebarProjectGroups({
  pinnedProjectIds,
  projects,
}: {
  pinnedProjectIds: readonly string[];
  projects: readonly ProjectExplorerProject[];
}): AppSidebarProjectGroups {
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const pinned: ProjectExplorerProject[] = [];
  const pinnedIdSet = new Set<string>();

  for (const projectId of pinnedProjectIds) {
    if (projectId === "" || pinnedIdSet.has(projectId)) {
      continue;
    }
    const project = projectById.get(projectId);
    if (!project) {
      continue;
    }
    pinned.push(project);
    pinnedIdSet.add(projectId);
    if (pinned.length === MAX_PINNED_PROJECTS) {
      break;
    }
  }

  return {
    pinned,
    projects: projects.filter((project) => !pinnedIdSet.has(project.id)),
  };
}
