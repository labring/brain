"use client";

import { DatabaseDeployer } from "@workspace/ui/components/database-deployer";
import {
  DockerDeployer,
  type DockerDeploymentSettings,
} from "@workspace/ui/components/docker-deployer";
import { GithubDeployer } from "@workspace/ui/components/github-deployer/github-deployer";
import { useCallback, useEffect, useState } from "react";

import { useProjectCreator } from "./project-creator.context";
import {
  ProjectCreatorOptionPicker,
  ProjectCreatorProjectNameField,
} from "./project-creator.pick";
import type {
  ProjectCreatorDatabaseChoice,
  ProjectCreatorSourceKind,
} from "./project-creator.types";

function GithubPanel() {
  const {
    meta: { githubDeployer },
  } = useProjectCreator();

  const states = githubDeployer?.states ?? {
    deployedRepo: null,
    isAuthorized: false,
    isLoading: false,
    repos: [] as const,
  };
  const actions = githubDeployer?.actions ?? {};

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
        childrenBeforeDeploy={
          meta.dockerDirect && dockerImage.trim() !== "" ? (
            <ProjectCreatorProjectNameField />
          ) : null
        }
        onDeploy={(settings) => {
          const projectDisplayName = states.projectDisplayName.trim();
          const error = actions.validateProjectDisplayName(projectDisplayName);
          if (error != null) {
            return;
          }
          actions.onDockerConfirm?.(settings, projectDisplayName);
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
          const error = actions.validateProjectDisplayName(projectDisplayName);
          if (error != null) {
            return;
          }
          actions.onDatabaseConfirm?.(settings, projectDisplayName);
        }}
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
