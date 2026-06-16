import type { ProjectExplorerProject } from "@/features/projects/explorer/project-explorer";

export type ProjectSidebarShortcutKind = "lastViewed" | "pinned";

export interface ProjectSidebarShortcutItem {
  kind: ProjectSidebarShortcutKind;
  project: ProjectExplorerProject;
}

export function createProjectSidebarShortcutItems({
  lastViewedProjectId,
  pinnedProjectIds,
  projects,
}: {
  lastViewedProjectId?: string;
  pinnedProjectIds: readonly string[];
  projects: readonly ProjectExplorerProject[];
}): ProjectSidebarShortcutItem[] {
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const normalizedPinnedIds = pinnedProjectIds.filter(
    (projectId, index, ids) =>
      projectId !== "" && ids.indexOf(projectId) === index
  );
  const pinnedProjectIdSet = new Set(normalizedPinnedIds);
  const items: ProjectSidebarShortcutItem[] = [];

  if (lastViewedProjectId && !pinnedProjectIdSet.has(lastViewedProjectId)) {
    const lastViewedProject = projectById.get(lastViewedProjectId);
    if (lastViewedProject) {
      items.push({ kind: "lastViewed", project: lastViewedProject });
    }
  }

  for (const projectId of normalizedPinnedIds) {
    const project = projectById.get(projectId);
    if (project) {
      items.push({ kind: "pinned", project });
    }
  }

  return items;
}
