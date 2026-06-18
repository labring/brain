import type { DatabaseDeploymentSettings } from "@/features/deployment/database-deployer";
import type { DockerDeploymentSettings } from "@/features/deployment/docker-deployer";
import { validateDockerDeploymentSettings } from "@/features/deployment/docker-deployment-settings";
import type { GithubDeployerRepo } from "@/features/deployment/github-deployer/github-deployer.types";
import type { ProjectExplorerProject } from "@/features/projects/explorer/project-explorer";
import type {
  DeploymentTaskRunner,
  DeploymentTaskSource,
  DeploymentTaskTarget,
} from "@/lib/deploy-task/types";
import { DIRECT_DB_DEPLOYMENT_OPTIONS } from "@/lib/direct-db-deployment-options";
import { isProjectDisplayNameTaken } from "@/lib/projects-to-explorer-projects";

export type DeploymentTarget =
  | {
      description?: string;
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

export interface DeploymentTaskCreateInput {
  namespace: string;
  prompt?: string;
  runner: DeploymentTaskRunner;
  source: DeploymentTaskSource;
  target: DeploymentTaskTarget;
}

export interface DeploymentTaskCreateResult {
  message: string;
  projectId: string | null;
  projectName: string | null;
  taskId: string | null;
}

export interface DeploymentTargetPipelineAdapters {
  createDeploymentTask: (
    input: DeploymentTaskCreateInput
  ) => Promise<DeploymentTaskCreateResult>;
}

export interface DeploymentTargetPipelineOptions {
  adapters: DeploymentTargetPipelineAdapters;
  credentialsReady: boolean;
  existingProjects?: readonly ProjectExplorerProject[];
  namespace: string;
  request: DeploymentTargetPipelineRequest;
}

export interface DeploymentTargetPipelineOutcome {
  createdProject: boolean;
  displayName?: string;
  kind: DeploymentTargetPipelineRequest["kind"];
  projectId: string;
  projectName: string;
  sourceLabel: string;
  taskId: string | null;
  taskMessage: string;
}

export function newProjectDeploymentTarget(
  displayName: string,
  description?: string
): DeploymentTarget {
  const normalizedDescription = description?.trim();
  return {
    displayName,
    ...(normalizedDescription ? { description: normalizedDescription } : {}),
    kind: "newProject",
  };
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

function normalizeTarget(
  target: DeploymentTarget,
  existingProjects: readonly ProjectExplorerProject[]
): DeploymentTaskTarget {
  if (target.kind === "existingProject") {
    const projectId = target.projectId.trim();
    if (!projectId) {
      throw new Error("Could not resolve the current project.");
    }
    return {
      kind: "existingProject",
      projectId,
      ...(target.projectName.trim()
        ? { projectName: target.projectName.trim() }
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
  return {
    ...(target.description?.trim()
      ? { description: target.description.trim() }
      : {}),
    displayName,
    kind: "newProject",
  };
}

function sourceLabel(source: DeploymentTaskSource): string {
  switch (source.kind) {
    case "database":
      return "database";
    case "docker":
      return String(source.settings.image ?? "Docker image");
    case "github":
      return source.repo.fullName;
    case "prompt":
      return "AI prompt";
    case "template":
      return source.templateName;
    default:
      return source satisfies never;
  }
}

function settingsRecord(settings: object): Record<string, unknown> {
  return { ...settings };
}

function deploymentTaskForRequest(
  request: DeploymentTargetPipelineRequest
): Pick<DeploymentTaskCreateInput, "runner" | "source"> {
  switch (request.kind) {
    case "docker": {
      const settingsValidation = validateDockerDeploymentSettings(
        request.settings
      );
      if (!settingsValidation.valid) {
        throw new Error(
          settingsValidation.errors[0]?.message ??
            "Docker deployment settings are invalid."
        );
      }
      return {
        runner: { kind: "direct" },
        source: { kind: "docker", settings: settingsRecord(request.settings) },
      };
    }
    case "database": {
      if (!request.settings.databaseId?.trim()) {
        throw new Error("Choose a database engine.");
      }
      if (
        !DIRECT_DB_DEPLOYMENT_OPTIONS.some(
          (option) => option.id === request.settings.databaseId
        )
      ) {
        throw new Error("Choose a database engine.");
      }
      return {
        runner: { kind: "direct" },
        source: {
          kind: "database",
          settings: settingsRecord(request.settings),
        },
      };
    }
    case "github": {
      const { fullName, repoUrl } = githubRepoFields(request.repository);
      return {
        runner: {
          kind: "ai",
          runtimeProvider: "devbox",
          skill: "sealos-deploy",
        },
        source: {
          kind: "github",
          repo: {
            fullName,
            id: String(request.repository.id),
            name: request.repository.name,
            url: repoUrl,
          },
        },
      };
    }
    case "template": {
      const templateName = request.templateName.trim();
      if (!templateName) {
        throw new Error("Choose a template.");
      }
      return {
        runner: { kind: "template" },
        source: {
          args: request.args,
          kind: "template",
          templateName,
        },
      };
    }
    default:
      return request satisfies never;
  }
}

export async function runDeploymentTargetPipeline(
  options: DeploymentTargetPipelineOptions
): Promise<DeploymentTargetPipelineOutcome> {
  assertPipelineEnvironment(options);

  const target = normalizeTarget(
    options.request.target,
    options.existingProjects ?? []
  );
  const taskInput = deploymentTaskForRequest(options.request);
  const task = await options.adapters.createDeploymentTask({
    ...taskInput,
    namespace: options.namespace,
    target,
  });
  const projectId =
    task.projectId?.trim() ||
    (target.kind === "existingProject" ? target.projectId.trim() : "");
  const projectName =
    task.projectName?.trim() ||
    (target.kind === "existingProject" ? target.projectName?.trim() : "") ||
    projectId;

  return {
    createdProject: target.kind === "newProject",
    ...(target.kind === "newProject"
      ? { displayName: target.displayName }
      : {}),
    kind: options.request.kind,
    projectId,
    projectName,
    sourceLabel: sourceLabel(taskInput.source),
    taskId: task.taskId,
    taskMessage: task.message,
  };
}
