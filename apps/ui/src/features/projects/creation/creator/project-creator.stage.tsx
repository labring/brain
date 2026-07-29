"use client";

import { useMemo } from "react";
import { DatabaseDeployer } from "@/features/deploy/database-deployer";
import { DockerDeployer } from "@/features/deploy/docker-deployer";
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
            const projectDescription = creatorStates.projectDescription.trim();
            if (
              creatorActions.validateProjectDescription(
                creatorStates.projectDescription
              ) != null
            ) {
              return;
            }
            if (creatorActions.onGithubConfirm) {
              return creatorActions.onGithubConfirm(repo, projectDescription);
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
            const projectDescription = creatorStates.projectDescription.trim();
            if (
              creatorActions.validateProjectDescription(
                creatorStates.projectDescription
              ) != null
            ) {
              return;
            }
            if (creatorActions.onTemplateConfirm) {
              return creatorActions.onTemplateConfirm(
                input.settings,
                input.template,
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
  const { actions, states } = useProjectCreator();
  const busy = states.confirmApplying;

  return (
    <div
      className="flex min-w-0 flex-col gap-3"
      data-slot="project-creator-docker"
    >
      <DockerDeployer
        busy={busy}
        onDeploy={(settings) => {
          const projectDescription = states.projectDescription.trim();
          if (
            actions.validateProjectDescription(states.projectDescription) !=
            null
          ) {
            return;
          }
          actions.onDockerConfirm?.(settings, projectDescription);
        }}
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
        onDeploy={(settings) => {
          const projectDescription = meta.databaseDirect
            ? ""
            : states.projectDescription.trim();
          if (
            actions.validateProjectDescription(
              meta.databaseDirect ? "" : states.projectDescription
            ) != null
          ) {
            return;
          }
          actions.onDatabaseConfirm?.(settings, projectDescription);
        }}
      />
    </div>
  );
}

function TemplatePanel() {
  const { actions, meta, states } = useProjectCreator();
  const busy = states.confirmApplying;
  const initialSettings = useMemo(
    () =>
      meta.initialTemplateName == null
        ? undefined
        : {
            ...(meta.initialTemplateArgs == null
              ? {}
              : { args: meta.initialTemplateArgs }),
            templateName: meta.initialTemplateName,
          },
    [meta.initialTemplateArgs, meta.initialTemplateName]
  );

  return (
    <div
      className="flex min-w-0 flex-col gap-3"
      data-slot="project-creator-template"
    >
      <TemplateDeployer
        autoDeploy={meta.templateDirect && meta.initialTemplateArgs != null}
        busy={busy}
        errorMessage={meta.templateOptionsError}
        initialSettings={initialSettings}
        loading={meta.templateOptionsLoading}
        onDeploy={(settings: TemplateDeploymentSettings, choice) => {
          const projectDescription = meta.templateDirect
            ? ""
            : states.projectDescription.trim();
          if (
            actions.validateProjectDescription(
              meta.templateDirect ? "" : states.projectDescription
            ) != null
          ) {
            return;
          }
          actions.onTemplateConfirm?.(settings, choice, projectDescription);
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
