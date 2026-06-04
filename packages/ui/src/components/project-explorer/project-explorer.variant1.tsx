"use client";

import type { ComponentProps } from "react";

import {
  ProjectExplorerHeaderBrand,
  ProjectExplorerHeaderToolbar,
  ProjectExplorerNewProjectButton,
  ProjectExplorerSearchField,
} from "./project-explorer.header";
import {
  ProjectExplorerHeader,
  ProjectExplorerShell,
} from "./project-explorer.layout";
import { ProjectExplorerList } from "./project-explorer.list";

/** Default composed preset: header (brand, search, new project) + list. */
export function ProjectExplorerVariant1({
  className,
  headerDescription,
  newProjectButtonIconOnly = false,
  ...props
}: ComponentProps<typeof ProjectExplorerShell> & {
  /** Subtitle below the brand label; omit to hide. */
  headerDescription?: string;
  /** Render the new-project action as an icon-only button. */
  newProjectButtonIconOnly?: boolean;
}) {
  return (
    <ProjectExplorerShell className={className} {...props}>
      <ProjectExplorerHeader>
        <div className="flex flex-col gap-6">
          <ProjectExplorerHeaderBrand description={headerDescription} />
          <ProjectExplorerHeaderToolbar>
            <ProjectExplorerSearchField />
            <ProjectExplorerNewProjectButton
              iconOnly={newProjectButtonIconOnly}
            />
          </ProjectExplorerHeaderToolbar>
        </div>
      </ProjectExplorerHeader>
      <ProjectExplorerList />
    </ProjectExplorerShell>
  );
}
