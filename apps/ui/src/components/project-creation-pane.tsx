"use client";

import { GithubDeployer } from "@workspace/ui/components/github-deployer/github-deployer";
import type { GithubDeployerStates } from "@workspace/ui/components/github-deployer/github-deployer.types";
import { ProjectCreator } from "@workspace/ui/components/project-creator/project-creator";
import type { ProjectCreatorRootProps } from "@workspace/ui/components/project-creator/project-creator.context";
import { SidePane } from "@workspace/ui/components/side-pane";
import { Plus } from "lucide-react";
import type { ProjectCreationPaneEntryMode } from "./project-creation-pane-state";

export type { ProjectCreationPaneEntryMode } from "./project-creation-pane-state";

const EMPTY_GITHUB_DEPLOYER_STATES: GithubDeployerStates = {
  deployedRepo: null,
  isAuthorized: false,
  isLoading: false,
  repos: [],
};

export function ProjectCreationPane({
  busy = false,
  creatorRootProps,
  entryMode = "general",
  onClose,
  resetKey,
}: {
  busy?: boolean;
  creatorRootProps: Pick<
    ProjectCreatorRootProps,
    | "actions"
    | "confirmApplying"
    | "databaseOptions"
    | "existingProjectDisplayNames"
    | "githubDeployer"
  >;
  entryMode?: ProjectCreationPaneEntryMode;
  onClose: () => void;
  resetKey: string | number;
}) {
  const githubDeployer = creatorRootProps.githubDeployer;
  const directGithubEntry = entryMode === "githubDirect";
  const directDockerEntry = entryMode === "dockerDirect";
  const directDatabaseEntry = entryMode === "databaseDirect";
  let subtitle =
    "Provide a project name and select the project creation method.";
  if (directGithubEntry) {
    subtitle = "Select a GitHub repository to create a project.";
  } else if (directDockerEntry) {
    subtitle = "Provide Docker deployment settings.";
  } else if (directDatabaseEntry) {
    subtitle = "Provide a project name and database deployment settings.";
  }

  let content = (
    <ProjectCreator.Root key={resetKey} {...creatorRootProps}>
      <ProjectCreator.Variant1 className="min-w-0" />
    </ProjectCreator.Root>
  );
  if (directGithubEntry) {
    content = (
      <div
        className="min-w-0"
        data-slot="project-creation-pane-github-direct"
        key={resetKey}
      >
        <GithubDeployer.Root
          actions={githubDeployer?.actions}
          states={githubDeployer?.states ?? EMPTY_GITHUB_DEPLOYER_STATES}
        >
          <GithubDeployer.Shell />
        </GithubDeployer.Root>
      </div>
    );
  } else if (directDockerEntry) {
    content = (
      <ProjectCreator.Root
        dockerDirect
        initialStep="docker-image"
        key={resetKey}
        {...creatorRootProps}
      >
        <ProjectCreator.Shell className="min-w-0">
          <ProjectCreator.Stage />
        </ProjectCreator.Shell>
      </ProjectCreator.Root>
    );
  } else if (directDatabaseEntry) {
    content = (
      <ProjectCreator.Root
        initialStep="database"
        key={resetKey}
        {...creatorRootProps}
      >
        <ProjectCreator.Shell className="min-w-0">
          <ProjectCreator.ProjectNameField />
          <ProjectCreator.Stage />
        </ProjectCreator.Shell>
      </ProjectCreator.Root>
    );
  }

  return (
    <SidePane
      busy={busy}
      closeAriaLabel="Close project creation pane"
      icon={<Plus aria-hidden className="size-4 text-blue-400" />}
      label="Project creation pane"
      onClose={onClose}
      subtitle={subtitle}
      title="Create New Project"
    >
      {content}
    </SidePane>
  );
}
