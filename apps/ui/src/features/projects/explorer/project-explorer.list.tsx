"use client";

import { cn } from "@workspace/ui/lib/utils";

import { useProjectExplorer } from "./project-explorer.context";
import { ProjectExplorerListItem } from "./project-explorer.list-item";
import type { ProjectExplorerProject } from "./project-explorer.types";

const DEFAULT_EMPTY_TITLE = "No projects yet";
const DEFAULT_EMPTY_DESCRIPTION = "Tell me what you want to build";
const NO_MATCH_TITLE = "No matching projects";
const NO_MATCH_DESCRIPTION = "Try a different search.";

function filterProjectsByQuery(
  projects: ProjectExplorerProject[],
  searchQuery: string
): ProjectExplorerProject[] {
  const q = searchQuery.trim().toLowerCase();
  if (q === "") {
    return projects;
  }
  return projects.filter((p) => p.name.toLowerCase().includes(q));
}

export function ProjectExplorerList({ className }: { className?: string }) {
  const { searchQuery, states } = useProjectExplorer();
  const { projects, empty } = states;
  const filteredProjects = filterProjectsByQuery(projects, searchQuery);

  if (projects.length === 0) {
    const title = empty?.title?.trim() || DEFAULT_EMPTY_TITLE;
    const description =
      empty?.description === undefined
        ? DEFAULT_EMPTY_DESCRIPTION
        : empty.description.trim() || null;

    return (
      <div className={cn(className)} data-slot="project-explorer-list">
        <div
          className="flex flex-col items-center justify-center rounded-xl px-4 py-10 text-center"
          data-slot="project-explorer-empty"
        >
          <p className="font-medium text-foreground text-sm">{title}</p>
          {description ? (
            <p className="mt-1.5 max-w-sm text-balance text-muted-foreground text-xs leading-relaxed">
              {description}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  if (filteredProjects.length === 0) {
    return (
      <div className={cn(className)} data-slot="project-explorer-list">
        <div
          className="flex flex-col items-center justify-center rounded-xl px-4 py-10 text-center"
          data-slot="project-explorer-filter-empty"
        >
          <p className="font-medium text-foreground text-sm">
            {NO_MATCH_TITLE}
          </p>
          <p className="mt-1.5 max-w-sm text-balance text-muted-foreground text-xs leading-relaxed">
            {NO_MATCH_DESCRIPTION}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn(className)} data-slot="project-explorer-list">
      <ul className="flex flex-col gap-2.5">
        {filteredProjects.map((project) => (
          <ProjectExplorerListItem key={project.id} project={project} />
        ))}
      </ul>
    </div>
  );
}
