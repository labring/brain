import type {
  DatabaseDeploymentChoice,
  DatabaseDeploymentSettings,
} from "@workspace/ui/components/database-deployer";
import type { DockerDeploymentSettings } from "@workspace/ui/components/docker-deployer";
import type { GithubDeployerRepo } from "@workspace/ui/components/github-deployer/github-deployer.types";
import type { ProjectExplorerProject } from "@workspace/ui/components/project-explorer/project-explorer";
import { validateDockerDeploymentSettings } from "@workspace/ui/lib/docker-deployment-settings";
import { renderDbDeploymentYaml } from "@/lib/db-deployment-yaml";
import { renderDockerDeploymentYaml } from "@/lib/docker-deployment-yaml";
import type { ChildResourceKind } from "@/lib/project-child-resource-name";
import { isProjectDisplayNameTaken } from "@/lib/projects-to-explorer-projects";

export interface TemplateDeploymentResourceSummary {
  name: string;
  resourceType: string;
  uid: string;
}

export type DeploymentTarget =
  | {
      displayName: string;
      kind: "newProject";
    }
  | {
      kind: "existingProject";
      projectName: string;
      projectId: string;
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
    }
  | {
      args?: Record<string, string>;
      kind: "template";
      target: DeploymentTarget;
      templateName: string;
    };

export interface GithubDeployTaskInput {
  namespace: string;
  projectId?: string;
  projectName: string;
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

export interface TemplateDeploymentInput {
  args?: Record<string, string>;
  instanceName: string;
  namespace: string;
  projectId: string;
  projectName: string;
  templateName: string;
}

export interface TemplateDeploymentResult {
  instanceName: string;
  resources: TemplateDeploymentResourceSummary[];
}

export interface DeploymentTargetPipelineAdapters {
  applyBrainProductManifest: (yaml: string) => Promise<void>;
  applyTemplateDeployment: (
    input: TemplateDeploymentInput
  ) => Promise<TemplateDeploymentResult>;
  createGithubDeployTask: (
    input: GithubDeployTaskInput
  ) => Promise<GithubDeployTaskResult>;
  createProject: (input: {
    displayName: string;
    namespace: string;
  }) => Promise<{ id: string }>;
  deleteProject: (input: { id: string; namespace: string }) => Promise<void>;
  fetchProjectIdByName: (name: string) => Promise<string | undefined>;
  generateChildResourceName: (
    projectName: string,
    kind: ChildResourceKind
  ) => string;
  generateProjectName: () => string;
}

export interface DeploymentTargetPipelineOptions {
  adapters: DeploymentTargetPipelineAdapters;
  credentialsReady: boolean;
  databaseOptions?: readonly DatabaseDeploymentChoice[];
  existingProjects?: readonly ProjectExplorerProject[];
  namespace: string;
  request: DeploymentTargetPipelineRequest;
  routingDomain?: string;
}

interface ResolvedDeploymentTarget {
  createdProject: boolean;
  displayName?: string;
  projectId?: string;
  projectName: string;
}

export type DeploymentTargetPipelineOutcome =
  | {
      apName: string;
      createdProject: boolean;
      displayName?: string;
      kind: "docker";
      projectName: string;
      projectId?: string;
    }
  | {
      createdProject: boolean;
      dbName: string;
      displayName?: string;
      kind: "database";
      projectName: string;
      projectId?: string;
    }
  | {
      createdProject: boolean;
      displayName?: string;
      kind: "github";
      projectName: string;
      projectId?: string;
      repoFullName: string;
      taskMessage: string;
      taskId: string | null;
    }
  | {
      createdProject: boolean;
      displayName?: string;
      instanceName: string;
      kind: "template";
      projectName: string;
      projectId?: string;
      resources: TemplateDeploymentResourceSummary[];
    };

export function newProjectDeploymentTarget(
  displayName: string
): DeploymentTarget {
  return { displayName, kind: "newProject" };
}

export function existingProjectDeploymentTarget(input: {
  projectName: string | null | undefined;
  projectId: string | null | undefined;
}): DeploymentTarget {
  return {
    kind: "existingProject",
    projectName: input.projectName?.trim() ?? "",
    projectId: input.projectId?.trim() ?? "",
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

function assertPipelineEnvironment(options: DeploymentTargetPipelineOptions) {
  if (!(options.credentialsReady && options.namespace.trim())) {
    throw new Error("Kubeconfig or namespace is missing.");
  }
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

async function resolveDeploymentTarget(
  options: DeploymentTargetPipelineOptions
): Promise<ResolvedDeploymentTarget> {
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
      ...(target.projectId.trim()
        ? { projectId: target.projectId.trim() }
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

  const project = await adapters.createProject({
    displayName,
    namespace,
  });

  return {
    createdProject: true,
    displayName,
    projectName: project.id,
    projectId: project.id,
  };
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

  const target = await resolveDeploymentTarget(options);
  const apName = options.adapters.generateChildResourceName(
    target.projectName,
    "ap"
  );
  const apYaml = renderDockerDeploymentYaml({
    name: apName,
    namespace: options.namespace,
    projectName: target.projectName,
    routingDomain: options.routingDomain?.trim() ?? "",
    settings: options.request.settings,
  });

  await options.adapters.applyBrainProductManifest(apYaml);

  return {
    apName,
    createdProject: target.createdProject,
    ...(target.displayName === undefined
      ? {}
      : { displayName: target.displayName }),
    kind: "docker",
    projectName: target.projectName,
    ...(target.projectId === undefined ? {} : { projectId: target.projectId }),
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
  const target = await resolveDeploymentTarget(options);
  const dbName = options.adapters.generateChildResourceName(
    target.projectName,
    "db"
  );
  const dbYaml = renderDbDeploymentYaml({
    engine: choice.engine,
    name: dbName,
    namespace: options.namespace,
    projectName: target.projectName,
    quota: options.request.settings.instancePreset,
    replicas: options.request.settings.replicas,
    template: choice.template,
  });

  await options.adapters.applyBrainProductManifest(dbYaml);

  return {
    createdProject: target.createdProject,
    dbName,
    ...(target.displayName === undefined
      ? {}
      : { displayName: target.displayName }),
    kind: "database",
    projectName: target.projectName,
    ...(target.projectId === undefined ? {} : { projectId: target.projectId }),
  };
}

async function runGithubPipeline(
  options: DeploymentTargetPipelineOptions & {
    request: Extract<DeploymentTargetPipelineRequest, { kind: "github" }>;
  }
): Promise<DeploymentTargetPipelineOutcome> {
  const { fullName, repoUrl } = githubRepoFields(options.request.repository);
  const target = await resolveDeploymentTarget(options);

  const task = await options.adapters.createGithubDeployTask({
    namespace: options.namespace,
    projectName: target.projectName,
    ...(target.projectId === undefined ? {} : { projectId: target.projectId }),
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
    ...(target.projectId === undefined ? {} : { projectId: target.projectId }),
    repoFullName: fullName,
    taskId: task.taskId,
    taskMessage: task.message,
  };
}

async function runTemplatePipeline(
  options: DeploymentTargetPipelineOptions & {
    request: Extract<DeploymentTargetPipelineRequest, { kind: "template" }>;
  }
): Promise<DeploymentTargetPipelineOutcome> {
  const templateName = options.request.templateName.trim();
  if (!templateName) {
    throw new Error("Choose a template.");
  }
  const target = await resolveDeploymentTarget(options);
  if (target.projectId == null || target.projectId.trim() === "") {
    throw new Error("Could not resolve the current project.");
  }
  const instanceName = options.adapters.generateChildResourceName(
    templateName,
    "template"
  );
  let result: TemplateDeploymentResult;
  try {
    result = await options.adapters.applyTemplateDeployment({
      args: options.request.args,
      instanceName,
      namespace: options.namespace,
      projectId: target.projectId,
      projectName: target.projectName,
      templateName,
    });
  } catch (error) {
    if (target.createdProject) {
      await options.adapters
        .deleteProject({
          id: target.projectId,
          namespace: options.namespace,
        })
        .catch(() => undefined);
    }
    throw error;
  }

  return {
    createdProject: target.createdProject,
    ...(target.displayName === undefined
      ? {}
      : { displayName: target.displayName }),
    instanceName: result.instanceName,
    kind: "template",
    projectName: target.projectName,
    projectId: target.projectId,
    resources: result.resources,
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
    case "template":
      return runTemplatePipeline({
        ...options,
        request: options.request,
      });
    default:
      return options.request satisfies never;
  }
}
