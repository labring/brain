"use client";

import {
  ProjectSourceDockerIcon,
  ProjectSourceGithubIcon,
} from "@workspace/ui/assets/project-source-icons";
import { SidePane } from "@workspace/ui/components/side-pane";
import { Database, PanelsTopLeft, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { GithubDeployer } from "@/features/deploy/github-deployer/github-deployer";
import type { GithubDeployerStates } from "@/features/deploy/github-deployer/github-deployer.types";
import { ProjectCreator } from "@/features/projects/creation/creator/project-creator";
import type { ProjectCreatorRootProps } from "@/features/projects/creation/creator/project-creator.context";
import type { ProjectCreatorSourceKind } from "@/features/projects/creation/creator/project-creator.types";
import type { ProjectCreationPaneEntryMode } from "./project-creation-pane-state";

export type { ProjectCreationPaneEntryMode } from "./project-creation-pane-state";

const EMPTY_GITHUB_DEPLOYER_STATES: GithubDeployerStates = {
  deployedRepo: null,
  isAuthorized: false,
  isLoading: false,
  repos: [],
};

function sourceKindFromEntryMode(
  entryMode: ProjectCreationPaneEntryMode
): ProjectCreatorSourceKind | null {
  switch (entryMode) {
    case "githubDirect":
      return "github";
    case "dockerDirect":
      return "docker-image";
    case "databaseDirect":
      return "database";
    case "templateDirect":
      return "template";
    default:
      return null;
  }
}

function projectCreationHeaderIcon(source: ProjectCreatorSourceKind | null) {
  switch (source) {
    case "github":
      return (
        <ProjectSourceGithubIcon
          aria-hidden
          className="size-4 text-foreground"
        />
      );
    case "docker-image":
      return (
        <ProjectSourceDockerIcon aria-hidden className="size-4 text-blue-400" />
      );
    case "database":
      return <Database aria-hidden className="size-4 text-blue-400" />;
    case "template":
      return <PanelsTopLeft aria-hidden className="size-4 text-blue-400" />;
    default:
      return <Plus aria-hidden className="size-4 text-blue-400" />;
  }
}

export function ProjectCreationPane({
  busy = false,
  creatorRootProps,
  entryMode = "general",
  onActiveSourceChange,
  onClose,
  resetKey,
}: {
  busy?: boolean;
  creatorRootProps: Pick<
    ProjectCreatorRootProps,
    | "actions"
    | "confirmApplying"
    | "databaseOptions"
    | "enabledSources"
    | "existingProjectDisplayNames"
    | "githubDeployer"
    | "initialTemplateArgs"
    | "initialTemplateName"
    | "templateOptions"
    | "templateOptionsError"
    | "templateOptionsLoading"
  >;
  entryMode?: ProjectCreationPaneEntryMode;
  onActiveSourceChange?: (source: ProjectCreatorSourceKind | null) => void;
  onClose: () => void;
  resetKey: string | number;
}) {
  const githubDeployer = creatorRootProps.githubDeployer;
  const [activeSource, setActiveSource] =
    useState<ProjectCreatorSourceKind | null>(() =>
      sourceKindFromEntryMode(entryMode)
    );
  const directGithubEntry = entryMode === "githubDirect";
  const directDockerEntry = entryMode === "dockerDirect";
  const directDatabaseEntry = entryMode === "databaseDirect";
  const directTemplateEntry = entryMode === "templateDirect";
  const initialStep = sourceKindFromEntryMode(entryMode);
  const [prevInitialStep, setPrevInitialStep] = useState(initialStep);
  if (initialStep !== prevInitialStep) {
    setPrevInitialStep(initialStep);
    setActiveSource(initialStep);
  }
  useEffect(() => {
    onActiveSourceChange?.(activeSource);
  }, [activeSource, onActiveSourceChange]);
  const handleStepChange = useCallback(
    (step: ProjectCreatorSourceKind | null) => {
      setActiveSource(step ?? initialStep);
    },
    [initialStep]
  );
  const rootPropsWithStepChange = useMemo(
    () => ({
      ...creatorRootProps,
      onStepChange: handleStepChange,
    }),
    [creatorRootProps, handleStepChange]
  );
  const headerIcon = projectCreationHeaderIcon(activeSource);
  let title = "Create New Project";
  let subtitle = "Select the project creation method.";
  if (directGithubEntry) {
    title = "GitHub Import";
    subtitle = "Import repository from URL or GitHub authorization.";
  } else if (directDockerEntry) {
    subtitle = "Provide Docker deployment settings.";
  } else if (directDatabaseEntry) {
    subtitle = "Provide database deployment settings.";
  } else if (directTemplateEntry) {
    subtitle = "Choose a template to create a project.";
  }

  let content = (
    <ProjectCreator.Root key={resetKey} {...rootPropsWithStepChange}>
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
        {...rootPropsWithStepChange}
      >
        <ProjectCreator.Shell className="min-w-0">
          <ProjectCreator.Stage />
        </ProjectCreator.Shell>
      </ProjectCreator.Root>
    );
  } else if (directDatabaseEntry) {
    content = (
      <ProjectCreator.Root
        databaseDirect
        initialStep="database"
        key={resetKey}
        {...rootPropsWithStepChange}
      >
        <ProjectCreator.Shell className="min-w-0">
          <ProjectCreator.Stage />
        </ProjectCreator.Shell>
      </ProjectCreator.Root>
    );
  } else if (directTemplateEntry) {
    content = (
      <ProjectCreator.Root
        initialStep="template"
        key={resetKey}
        templateDirect
        {...rootPropsWithStepChange}
      >
        <ProjectCreator.Shell className="min-w-0">
          <ProjectCreator.Stage />
        </ProjectCreator.Shell>
      </ProjectCreator.Root>
    );
  }

  return (
    <SidePane
      busy={busy}
      closeAriaLabel="Close project creation pane"
      icon={headerIcon}
      label="Project creation pane"
      onClose={onClose}
      subtitle={subtitle}
      title={title}
    >
      {content}
    </SidePane>
  );
}
