import type {
  DatabaseDeploymentChoice,
  DatabaseDeploymentSettings,
} from "@workspace/ui/components/database-deployer";
import type { DockerDeploymentSettings } from "@workspace/ui/components/docker-deployer";
import type { GithubDeployerRepo } from "@workspace/ui/components/github-deployer/github-deployer.types";
import type { ProjectExplorerProject } from "@workspace/ui/components/project-explorer/project-explorer";
import { validateDockerDeploymentSettings } from "@workspace/ui/lib/docker-deployment-settings";
import type { CompositionListItem } from "@/lib/crossplane-composition-list";
import { renderDbDeploymentYaml } from "@/lib/db-deployment-yaml";
import {
  DEFAULT_DOCKER_AP_COMPOSITION_NAME,
  renderDockerDeploymentYaml,
} from "@/lib/docker-deployment-yaml";
import { mergeProjectMetadataDisplayName } from "@/lib/project-yaml-metadata";
import { isProjectDisplayNameTaken } from "@/lib/projects-to-explorer-projects";
import {
  joinKubeYamlDocuments,
  renderCrossplaneCompositionTemplate,
} from "@/lib/render-crossplane-template";

export const DEFAULT_PROJECT_COMPOSITION_NAME =
  "project-instance-go-templating";

export type DeploymentTarget =
  | {
      displayName: string;
      kind: "newProject";
    }
  | {
      kind: "existingProject";
      projectName: string;
      projectUid: string;
    };

export type DeploymentTargetPipelineRequest =
  | {
      kind: "docker";
      settings: DockerDeploymentSettings;
      target: DeploymentTarget;
    }
  | {
      kind: "database";
      settings: DatabaseDeploymentSettings;
      target: DeploymentTarget;
    }
  | {
      kind: "github";
      repository: GithubDeployerRepo;
      target: DeploymentTarget;
    };

export interface GithubDeployTaskInput {
  namespace: string;
  projectName: string;
  projectUid?: string;
  repo: {
    fullName: string;
    id: string | number;
    name: string;
    url: string;
  };
}

export interface GithubDeployTaskResult {
  message: string;
  taskId: string | null;
}

export interface DeploymentTargetPipelineAdapters {
  applyYaml: (yaml: string) => Promise<void>;
  createGithubDeployTask: (
    input: GithubDeployTaskInput
  ) => Promise<GithubDeployTaskResult>;
  fetchProjectUidByName: (name: string) => Promise<string | undefined>;
  generateChildResourceName: (projectName: string) => string;
  generateProjectName: () => string;
}

export interface DeploymentTargetPipelineOptions {
  adapters: DeploymentTargetPipelineAdapters;
  apCompositionRows?: readonly CompositionListItem[];
  credentialsReady: boolean;
  databaseOptions?: readonly DatabaseDeploymentChoice[];
  existingProjects?: readonly ProjectExplorerProject[];
  namespace: string;
  projectCompositionRows?: readonly CompositionListItem[];
  request: DeploymentTargetPipelineRequest;
  routingDomain?: string;
}

interface ResolvedDeploymentTarget {
  createdProject: boolean;
  displayName?: string;
  projectName: string;
  projectUid?: string;
  projectYaml?: string;
}

export type DeploymentTargetPipelineOutcome =
  | {
      apName: string;
      createdProject: boolean;
      displayName?: string;
      kind: "docker";
      projectName: string;
      projectUid?: string;
    }
  | {
      createdProject: boolean;
      dbName: string;
      displayName?: string;
      kind: "database";
      projectName: string;
      projectUid?: string;
    }
  | {
      createdProject: boolean;
      displayName?: string;
      kind: "github";
      projectName: string;
      projectUid?: string;
      repoFullName: string;
      taskMessage: string;
      taskId: string | null;
    };

export function newProjectDeploymentTarget(
  displayName: string
): DeploymentTarget {
  return { displayName, kind: "newProject" };
}

export function existingProjectDeploymentTarget(input: {
  projectName: string | null | undefined;
  projectUid: string | null | undefined;
}): DeploymentTarget {
  return {
    kind: "existingProject",
    projectName: input.projectName?.trim() ?? "",
    projectUid: input.projectUid?.trim() ?? "",
  };
}

export function projectDisplayNameValidationError(
  existingProjects: readonly ProjectExplorerProject[],
  displayName: string
): string | null {
  const trimmed = displayName.trim();
  if (!trimmed) {
    return "Project name is required.";
  }
  if (isProjectDisplayNameTaken(existingProjects, trimmed)) {
    return `A project named "${trimmed}" already exists.`;
  }
  return null;
}

function pickProjectTemplate(
  rows: readonly CompositionListItem[] | undefined
): string | undefined {
  return (
    rows?.find(
      (row) => row.metadata.compositionName === DEFAULT_PROJECT_COMPOSITION_NAME
    )?.template ?? rows?.find((row) => row.kind === "Project")?.template
  );
}

function pickApTemplate(
  rows: readonly CompositionListItem[] | undefined
): string | undefined {
  return (
    rows?.find(
      (row) =>
        row.metadata.compositionName === DEFAULT_DOCKER_AP_COMPOSITION_NAME
    )?.template ?? rows?.find((row) => row.kind === "AP")?.template
  );
}

function assertPipelineEnvironment(options: DeploymentTargetPipelineOptions) {
  if (!(options.credentialsReady && options.namespace.trim())) {
    throw new Error("Kubeconfig or namespace is missing.");
  }
}

function resolveProjectTemplate(
  projectCompositionRows: readonly CompositionListItem[] | undefined
): string {
  const projectTemplate = pickProjectTemplate(projectCompositionRows);
  if (!projectTemplate?.trim()) {
    throw new Error(
      "Could not load a Project composition template from the cluster."
    );
  }
  return projectTemplate;
}

function resolveApTemplate(
  apCompositionRows: readonly CompositionListItem[] | undefined
): string {
  const apTemplate = pickApTemplate(apCompositionRows);
  if (!apTemplate?.trim()) {
    throw new Error(
      "Could not load an AP composition template from the cluster."
    );
  }
  return apTemplate;
}

function resolveDatabaseChoice(
  databaseOptions: readonly DatabaseDeploymentChoice[] | undefined,
  settings: DatabaseDeploymentSettings
): DatabaseDeploymentChoice {
  const choice = databaseOptions?.find(
    (option) => option.id === settings.databaseId
  );
  if (choice == null) {
    throw new Error("Choose a database engine.");
  }
  return choice;
}

function githubRepoFields(repository: GithubDeployerRepo): {
  fullName: string;
  repoUrl: string;
} {
  const fullName = repository.fullName?.trim();
  if (!fullName) {
    throw new Error("Repository full name is missing.");
  }
  return {
    fullName,
    repoUrl: repository.url?.trim() || `https://github.com/${fullName}`,
  };
}

function projectYamlForNewTarget(options: {
  displayName: string;
  namespace: string;
  projectName: string;
  projectTemplate: string;
}): string {
  return mergeProjectMetadataDisplayName(
    renderCrossplaneCompositionTemplate(options.projectTemplate, {
      name: options.projectName,
      namespace: options.namespace,
    }),
    options.displayName
  );
}

function resolveDeploymentTarget(
  options: DeploymentTargetPipelineOptions
): ResolvedDeploymentTarget {
  const {
    adapters,
    existingProjects = [],
    namespace,
    target,
  } = {
    ...options,
    target: options.request.target,
  };

  if (target.kind === "existingProject") {
    const projectName = target.projectName.trim();
    if (projectName === "") {
      throw new Error("Could not resolve the current project.");
    }
    return {
      createdProject: false,
      projectName,
      ...(target.projectUid.trim()
        ? { projectUid: target.projectUid.trim() }
        : {}),
    };
  }

  const displayName = target.displayName.trim();
  const displayNameError = projectDisplayNameValidationError(
    existingProjects,
    displayName
  );
  if (displayNameError != null) {
    throw new Error(displayNameError);
  }

  const projectTemplate = resolveProjectTemplate(
    options.projectCompositionRows
  );
  const projectName = adapters.generateProjectName();

  return {
    createdProject: true,
    displayName,
    projectName,
    projectYaml: projectYamlForNewTarget({
      displayName,
      namespace,
      projectName,
      projectTemplate,
    }),
  };
}

function fetchCreatedProjectUid(
  target: ResolvedDeploymentTarget,
  adapters: DeploymentTargetPipelineAdapters
): Promise<string | undefined> {
  if (!target.createdProject) {
    return Promise.resolve(target.projectUid);
  }
  return adapters.fetchProjectUidByName(target.projectName);
}

async function runDockerPipeline(
  options: DeploymentTargetPipelineOptions & {
    request: Extract<DeploymentTargetPipelineRequest, { kind: "docker" }>;
  }
): Promise<DeploymentTargetPipelineOutcome> {
  const settingsValidation = validateDockerDeploymentSettings(
    options.request.settings
  );
  if (!settingsValidation.valid) {
    throw new Error(
      settingsValidation.errors[0]?.message ??
        "Docker deployment settings are invalid."
    );
  }

  const apTemplate = resolveApTemplate(options.apCompositionRows);
  const target = resolveDeploymentTarget(options);
  const apName = options.adapters.generateChildResourceName(target.projectName);
  const apYaml = renderDockerDeploymentYaml({
    name: apName,
    namespace: options.namespace,
    projectName: target.projectName,
    routingDomain: options.routingDomain?.trim() ?? "",
    settings: options.request.settings,
    template: apTemplate,
  });

  await options.adapters.applyYaml(
    target.projectYaml === undefined
      ? apYaml
      : joinKubeYamlDocuments([target.projectYaml, apYaml])
  );

  const projectUid = await fetchCreatedProjectUid(target, options.adapters);
  return {
    apName,
    createdProject: target.createdProject,
    ...(target.displayName === undefined
      ? {}
      : { displayName: target.displayName }),
    kind: "docker",
    projectName: target.projectName,
    ...(projectUid === undefined ? {} : { projectUid }),
  };
}

async function runDatabasePipeline(
  options: DeploymentTargetPipelineOptions & {
    request: Extract<DeploymentTargetPipelineRequest, { kind: "database" }>;
  }
): Promise<DeploymentTargetPipelineOutcome> {
  const choice = resolveDatabaseChoice(
    options.databaseOptions,
    options.request.settings
  );
  const target = resolveDeploymentTarget(options);
  const dbName = options.adapters.generateChildResourceName(target.projectName);
  const dbYaml = renderDbDeploymentYaml({
    compositionName: choice.id,
    engine: choice.engine,
    name: dbName,
    namespace: options.namespace,
    projectName: target.projectName,
    quota: options.request.settings.instancePreset,
    replicas: options.request.settings.replicas,
    template: choice.template,
  });

  await options.adapters.applyYaml(
    target.projectYaml === undefined
      ? dbYaml
      : joinKubeYamlDocuments([target.projectYaml, dbYaml])
  );

  const projectUid = await fetchCreatedProjectUid(target, options.adapters);
  return {
    createdProject: target.createdProject,
    dbName,
    ...(target.displayName === undefined
      ? {}
      : { displayName: target.displayName }),
    kind: "database",
    projectName: target.projectName,
    ...(projectUid === undefined ? {} : { projectUid }),
  };
}

async function runGithubPipeline(
  options: DeploymentTargetPipelineOptions & {
    request: Extract<DeploymentTargetPipelineRequest, { kind: "github" }>;
  }
): Promise<DeploymentTargetPipelineOutcome> {
  const { fullName, repoUrl } = githubRepoFields(options.request.repository);
  const target = resolveDeploymentTarget(options);

  if (target.projectYaml !== undefined) {
    await options.adapters.applyYaml(target.projectYaml);
  }

  const projectUid = await fetchCreatedProjectUid(target, options.adapters);
  const task = await options.adapters.createGithubDeployTask({
    namespace: options.namespace,
    projectName: target.projectName,
    ...(projectUid === undefined ? {} : { projectUid }),
    repo: {
      fullName,
      id: options.request.repository.id,
      name: options.request.repository.name,
      url: repoUrl,
    },
  });

  return {
    createdProject: target.createdProject,
    ...(target.displayName === undefined
      ? {}
      : { displayName: target.displayName }),
    kind: "github",
    projectName: target.projectName,
    ...(projectUid === undefined ? {} : { projectUid }),
    repoFullName: fullName,
    taskId: task.taskId,
    taskMessage: task.message,
  };
}

export function runDeploymentTargetPipeline(
  options: DeploymentTargetPipelineOptions
): Promise<DeploymentTargetPipelineOutcome> {
  assertPipelineEnvironment(options);
  switch (options.request.kind) {
    case "docker":
      return runDockerPipeline({
        ...options,
        request: options.request,
      });
    case "database":
      return runDatabasePipeline({
        ...options,
        request: options.request,
      });
    case "github":
      return runGithubPipeline({
        ...options,
        request: options.request,
      });
    default:
      return options.request satisfies never;
  }
}
