"use client";

import { useCallback, useEffect, useState } from "react";
import { DatabaseDeployer } from "@/features/deploy/database-deployer";
import {
  DockerDeployer,
  type DockerDeploymentSettings,
} from "@/features/deploy/docker-deployer";
import { GithubDeployer } from "@/features/deploy/github-deployer/github-deployer";
import type { GithubDeployerRepo } from "@/features/deploy/github-deployer/github-deployer.types";
import {
  TemplateDeployer,
  type TemplateDeploymentSettings,
} from "@/features/deploy/template-deployer";

import { useProjectCreator } from "./project-creator.context";
import { ProjectCreatorOptionPicker } from "./project-creator.pick";
import type {
  ProjectCreatorDatabaseChoice,
  ProjectCreatorSourceKind,
} from "./project-creator.types";

function GithubPanel() {
  const {
    actions: creatorActions,
    meta: { githubDeployer },
    states: creatorStates,
  } = useProjectCreator();

  const states = githubDeployer?.states ?? {
    deployedRepo: null,
    isAuthorized: false,
    isLoading: false,
    repos: [] as const,
  };
  const githubActions = githubDeployer?.actions ?? {};
  const canDeploy =
    creatorActions.onGithubConfirm != null || githubActions.onDeploy != null;
  const actions = {
    ...githubActions,
    ...(canDeploy
      ? {
          onDeploy: (repo: GithubDeployerRepo) => {
            const projectDisplayName = creatorStates.projectDisplayName.trim();
            const projectDescription = creatorStates.projectDescription.trim();
            const displayNameError =
              creatorActions.validateProjectDisplayName(projectDisplayName);
            const descriptionError = creatorActions.validateProjectDescription(
              creatorStates.projectDescription
            );
            if (displayNameError != null || descriptionError != null) {
              return;
            }
            if (creatorActions.onGithubConfirm) {
              return creatorActions.onGithubConfirm(
                repo,
                projectDisplayName,
                projectDescription
              );
            }
            return githubActions.onDeploy?.(repo);
          },
        }
      : {}),
    ...(creatorActions.onTemplateConfirm != null ||
    githubActions.onDeployTemplate != null
      ? {
          onDeployTemplate: (
            input: Parameters<
              NonNullable<typeof githubActions.onDeployTemplate>
            >[0]
          ) => {
            const projectDisplayName = creatorStates.projectDisplayName.trim();
            const projectDescription = creatorStates.projectDescription.trim();
            const displayNameError =
              creatorActions.validateProjectDisplayName(projectDisplayName);
            const descriptionError = creatorActions.validateProjectDescription(
              creatorStates.projectDescription
            );
            if (displayNameError != null || descriptionError != null) {
              return;
            }
            if (creatorActions.onTemplateConfirm) {
              return creatorActions.onTemplateConfirm(
                input.settings,
                input.template,
                projectDisplayName,
                projectDescription
              );
            }
            return githubActions.onDeployTemplate?.(input);
          },
        }
      : {}),
  };

  return (
    <div
      className="flex min-w-0 flex-col gap-3"
      data-slot="project-creator-github"
    >
      <GithubDeployer.Root actions={actions} states={states}>
        <GithubDeployer.Shell />
      </GithubDeployer.Root>
    </div>
  );
}

function DockerPanel() {
  const { actions, meta, states } = useProjectCreator();
  const [dockerImage, setDockerImage] = useState("");
  const { deriveDockerProjectDisplayName, setProjectDisplayName } = actions;

  const busy = states.confirmApplying;
  const updateDockerImage = useCallback(
    (settings: DockerDeploymentSettings) => {
      setDockerImage(settings.image);
    },
    []
  );

  useEffect(() => {
    const imageRef = dockerImage.trim();
    if (!meta.dockerDirect || imageRef === "") {
      return;
    }
    setProjectDisplayName(
      deriveDockerProjectDisplayName?.(imageRef) ?? "Docker Project"
    );
  }, [
    deriveDockerProjectDisplayName,
    dockerImage,
    meta.dockerDirect,
    setProjectDisplayName,
  ]);

  return (
    <div
      className="flex min-w-0 flex-col gap-3"
      data-slot="project-creator-docker"
    >
      <DockerDeployer
        busy={busy}
        onDeploy={(settings) => {
          const projectDisplayName = states.projectDisplayName.trim();
          const projectDescription = states.projectDescription.trim();
          const error = actions.validateProjectDisplayName(projectDisplayName);
          const descriptionError = actions.validateProjectDescription(
            states.projectDescription
          );
          if (error != null || descriptionError != null) {
            return;
          }
          actions.onDockerConfirm?.(
            settings,
            projectDisplayName,
            projectDescription
          );
        }}
        onSettingsChange={updateDockerImage}
      />
    </div>
  );
}

function DatabasePanel({
  databaseOptions,
}: {
  databaseOptions: ProjectCreatorDatabaseChoice[];
}) {
  const { actions, meta, states } = useProjectCreator();
  const busy = states.confirmApplying;

  return (
    <div
      className="flex min-w-0 flex-col gap-3"
      data-slot="project-creator-database"
    >
      <DatabaseDeployer
        busy={busy}
        databaseOptions={databaseOptions}
        onDeploy={(settings, choice) => {
          const derivedProjectDisplayName = actions
            .deriveDatabaseProjectDisplayName?.(choice)
            .trim();
          const projectDisplayName = meta.databaseDirect
            ? derivedProjectDisplayName ||
              choice.label.trim() ||
              choice.engine.trim() ||
              "Database Project"
            : states.projectDisplayName.trim();
          const projectDescription = meta.databaseDirect
            ? ""
            : states.projectDescription.trim();
          const error = actions.validateProjectDisplayName(projectDisplayName);
          const descriptionError = actions.validateProjectDescription(
            meta.databaseDirect ? "" : states.projectDescription
          );
          if (error != null || descriptionError != null) {
            return;
          }
          actions.onDatabaseConfirm?.(
            settings,
            projectDisplayName,
            projectDescription
          );
        }}
      />
    </div>
  );
}

function TemplatePanel() {
  const { actions, meta, states } = useProjectCreator();
  const [templateTitle, setTemplateTitle] = useState("");
  const { setProjectDisplayName } = actions;
  const busy = states.confirmApplying;

  useEffect(() => {
    if (!meta.templateDirect || templateTitle.trim() === "") {
      return;
    }
    setProjectDisplayName(templateTitle.trim());
  }, [meta.templateDirect, setProjectDisplayName, templateTitle]);

  return (
    <div
      className="flex min-w-0 flex-col gap-3"
      data-slot="project-creator-template"
    >
      <TemplateDeployer
        busy={busy}
        onDeploy={(settings: TemplateDeploymentSettings, choice) => {
          const projectDisplayName = meta.templateDirect
            ? choice.title.trim() || choice.name.trim() || "Template Project"
            : states.projectDisplayName.trim();
          const projectDescription = meta.templateDirect
            ? ""
            : states.projectDescription.trim();
          const error = actions.validateProjectDisplayName(projectDisplayName);
          const descriptionError = actions.validateProjectDescription(
            meta.templateDirect ? "" : states.projectDescription
          );
          if (error != null || descriptionError != null) {
            return;
          }
          actions.onTemplateConfirm?.(
            settings,
            choice,
            projectDisplayName,
            projectDescription
          );
        }}
        onSettingsChange={(_settings, choice) => {
          setTemplateTitle(choice?.title ?? "");
        }}
        templateOptions={meta.templateOptions}
      />
    </div>
  );
}

function renderActivePanel(
  step: ProjectCreatorSourceKind,
  databaseOptions: ProjectCreatorDatabaseChoice[]
) {
  switch (step) {
    case "github":
      return <GithubPanel />;
    case "docker-image":
      return <DockerPanel />;
    case "database":
      return <DatabasePanel databaseOptions={databaseOptions} />;
    case "template":
      return <TemplatePanel />;
    default:
      return null;
  }
}

export function ProjectCreatorStage({ className }: { className?: string }) {
  const {
    meta: { databaseOptions },
    states: { step },
  } = useProjectCreator("ProjectCreator.Stage");

  return (
    <div className={className} data-slot="project-creator-stage">
      {step === null ? (
        <ProjectCreatorOptionPicker />
      ) : (
        renderActivePanel(step, databaseOptions)
      )}
    </div>
  );
}
