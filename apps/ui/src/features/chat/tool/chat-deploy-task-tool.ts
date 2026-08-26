import { tool } from "ai";
import { z } from "zod";
import {
  createDeployTaskToolInputSchema,
  defaultRunnerForSource,
} from "@/features/chat/tool/chat-deploy-task-input";
import {
  chatToolIntentionField,
  logChatToolIntention,
} from "@/features/chat/tool/chat-tool-intention";
import {
  adoptLegacyGithubConnectionForOwner,
  getGithubConnectionStatusForOwner,
} from "@/features/deploy/github/connection-service";
import {
  CURRENT_GITHUB_OWNER_IDENTITY_VERSION,
  type VerifiedGithubConnectionActor,
} from "@/features/deploy/github/owner-identity";
import {
  cancelDeployTaskAction,
  createDeployTaskAction,
  submitDeployTaskInputAction,
} from "@/features/deploy/task/engine/actions";
import { getDeployTaskEngineContext } from "@/features/deploy/task/engine/server";
import {
  resolveDeployTaskTargetForCreate,
  runDeployTask,
} from "@/features/deploy/task/runner";
import {
  CURRENT_DEPLOYMENT_CREDENTIAL_BINDING_VERSION,
  type DeploymentCredentialBinding,
} from "@/features/deploy/task/schema";
import {
  getDeployTaskSnapshot,
  getDeployTaskTimelineSnapshot,
  toDeployTaskDTO,
} from "@/features/deploy/task/service";
import {
  type DeploymentTaskTarget,
  submitDeployTaskInputSchema,
} from "@/features/deploy/task/types";
import { IdentityBindingSupersededError } from "@/lib/identity-fingerprint-core";

const GITHUB_CONNECTION_REQUIRED_ERROR =
  "Connect GitHub in Settings before deploying from a repository.";
const GITHUB_AUTHENTICATION_REQUIRED_ERROR =
  "Authentication is required. Sign in again before deploying from GitHub.";

const getDeployTaskStatusToolInputSchema = z.object({
  intention: chatToolIntentionField,
  taskId: z.string().trim().min(1),
});

const submitDeployTaskInputToolInputSchema = submitDeployTaskInputSchema.extend(
  {
    intention: chatToolIntentionField,
    taskId: z.string().trim().min(1),
  }
);

const cancelDeployTaskToolInputSchema = z.object({
  intention: chatToolIntentionField,
  taskId: z.string().trim().min(1),
});

function defaultTargetFromContext(options: {
  assistantContext?: {
    projectName?: string;
    projectId?: string;
  };
}): DeploymentTaskTarget | null {
  const projectId = options.assistantContext?.projectId?.trim();
  if (!projectId) {
    return null;
  }
  const projectName = options.assistantContext?.projectName?.trim();
  return {
    kind: "existingProject",
    projectId,
    ...(projectName ? { projectName } : {}),
  };
}

/**
 * Chat mirrors create, cancel, and explain through the same engine lifecycle
 * as the UI (ADR 0038), so chat and canvas never disagree about a task.
 */
export function createDeployTaskTools(
  options: {
    assistantContext?: {
      projectName?: string;
      projectId?: string;
    };
    kubeconfig: string;
    kubernetesNamespace: string;
    workspaceActor: string;
    workspaceUserUid: string;
  },
  dependencies: {
    adoptLegacyGithubConnectionForOwner?: typeof adoptLegacyGithubConnectionForOwner;
    createDeployTaskAction?: typeof createDeployTaskAction;
    getGithubConnectionStatusForOwner?: typeof getGithubConnectionStatusForOwner;
    getDeployTaskEngineContext?: typeof getDeployTaskEngineContext;
    getDeployTaskSnapshot?: typeof getDeployTaskSnapshot;
    getDeployTaskTimelineSnapshot?: typeof getDeployTaskTimelineSnapshot;
    runDeployTask?: typeof runDeployTask;
    submitDeployTaskInputAction?: typeof submitDeployTaskInputAction;
    toDeployTaskDTO?: typeof toDeployTaskDTO;
  } = {}
) {
  const namespace = options.kubernetesNamespace;
  const actionActor = options.workspaceActor;
  const encodedKubeconfig = encodeURIComponent(options.kubeconfig);
  const engineContext =
    dependencies.getDeployTaskEngineContext ?? getDeployTaskEngineContext;
  const readTaskSnapshot =
    dependencies.getDeployTaskSnapshot ?? getDeployTaskSnapshot;
  const readTimelineSnapshot =
    dependencies.getDeployTaskTimelineSnapshot ?? getDeployTaskTimelineSnapshot;
  const runTask = dependencies.runDeployTask ?? runDeployTask;
  const submitTaskInput =
    dependencies.submitDeployTaskInputAction ?? submitDeployTaskInputAction;
  const createTask =
    dependencies.createDeployTaskAction ?? createDeployTaskAction;
  const projectTask = dependencies.toDeployTaskDTO ?? toDeployTaskDTO;
  const readGithubConnection =
    dependencies.getGithubConnectionStatusForOwner ??
    getGithubConnectionStatusForOwner;
  const adoptLegacyGithubConnection =
    dependencies.adoptLegacyGithubConnectionForOwner ??
    adoptLegacyGithubConnectionForOwner;

  const githubActor: VerifiedGithubConnectionActor = {
    legacyWorkspaceActor: options.workspaceActor,
    owner: {
      namespace: options.kubernetesNamespace,
      ownerIdentityVersion: CURRENT_GITHUB_OWNER_IDENTITY_VERSION,
      userUid: options.workspaceUserUid,
    },
  };

  /**
   * Resolve the initiator's binding the same way the deploy-task route does
   * (ADR-0036/0056/0059). Missing or superseded credentials fail before task
   * creation; infrastructure errors propagate instead of degrading to an
   * anonymous deployment.
   */
  async function resolveChatGithubBinding(): Promise<
    | { credentialBinding: DeploymentCredentialBinding; ok: true }
    | { error: string; ok: false }
  > {
    try {
      await adoptLegacyGithubConnection(githubActor);
      const connection = await readGithubConnection(githubActor.owner);
      if (connection == null) {
        return { error: GITHUB_CONNECTION_REQUIRED_ERROR, ok: false };
      }
      return {
        credentialBinding: {
          connectionRef: connection.id,
          credentialOwner: githubActor.owner.userUid,
          version: CURRENT_DEPLOYMENT_CREDENTIAL_BINDING_VERSION,
        },
        ok: true,
      };
    } catch (error) {
      if (error instanceof IdentityBindingSupersededError) {
        return { error: GITHUB_AUTHENTICATION_REQUIRED_ERROR, ok: false };
      }
      throw error;
    }
  }

  const createDeployTaskTool = tool({
    description: [
      "Create a long-running Deployment Task in SealAI.",
      "Use this when the user asks to deploy a Docker image, a database, a template, a GitHub repository, or a prompt.",
      "GitHub repository deployments require the user to connect GitHub in Settings. If no connection is available, report that requirement instead of retrying the repository as a prompt or Docker source.",
      "The task resolves or creates its target Project, runs the server-selected Deployment Runner, applies artifacts, and reports progress separately.",
      "Do not provide a runner; Docker and database sources use the Direct Runner, template sources use the Template Runner, and GitHub or prompt sources use the AI Runner.",
      "If the user is already inside a Project, omit target to deploy into the current Project; otherwise provide a newProject target.",
      "On a newProject target, displayName is optional: prefer a short name that reflects what the user asked to deploy, and omit it to let the platform derive one from the Deployment Source.",
      "A displayName you provide is used verbatim; if it is already taken the call fails, so retry once with a different name.",
    ].join(" "),
    inputSchema: createDeployTaskToolInputSchema,
    execute: async (input) => {
      logChatToolIntention("createDeployTask", input.intention);
      const target = input.target ?? defaultTargetFromContext(options);
      if (target == null) {
        return {
          ok: false,
          error:
            "No deployment target was provided. Use target.kind newProject with a displayName, or open a Project first.",
        };
      }
      let credentialBinding: DeploymentCredentialBinding | undefined;
      if (input.source.kind === "github") {
        const bindingResolution = await resolveChatGithubBinding();
        if (!bindingResolution.ok) {
          return bindingResolution;
        }
        credentialBinding = bindingResolution.credentialBinding;
      }

      const result = await createTask(engineContext(), {
        create: {
          ...(credentialBinding == null ? {} : { credentialBinding }),
          createdFrom: "chat",
          creatingActor: actionActor,
          namespace,
          prompt: input.prompt,
          runner: defaultRunnerForSource(input.source),
          source: input.source,
          target,
        },
        resolveTarget: resolveDeployTaskTargetForCreate,
        run: (handle, task) =>
          runTask(handle, {
            encodedKubeconfig,
            // Full template args from the chat request: the engine
            // persists a stripped copy, so sensitive values reach the
            // runner only through this in-memory hand-off (ADR 0037).
            sourceArgValues:
              input.source.kind === "template" ? input.source.args : undefined,
            taskId: task.id,
          }),
      });
      if (result.kind === "project-name-conflict") {
        return {
          ok: false,
          error: `A project named "${result.displayName}" already exists. Retry with a different displayName, or omit it to let the platform name the Project.`,
        };
      }
      if (result.kind !== "created") {
        return {
          ok: false,
          error: "Could not create the deploy task.",
        };
      }
      const snapshot = await readTaskSnapshot(result.task.id, namespace);
      return {
        ok: true,
        task: snapshot?.task ?? projectTask(result.task),
        taskUrl: `/deploy-tasks/${result.task.id}`,
      };
    },
  });

  const getDeployTaskStatusTool = tool({
    description:
      "Get the current task state, safe recent events, and task-owned Deployment Timeline for a SealAI deploy task.",
    inputSchema: getDeployTaskStatusToolInputSchema,
    execute: async (input) => {
      logChatToolIntention("getDeployTaskStatus", input.intention);
      const snapshot = await readTimelineSnapshot(input.taskId, namespace);
      return snapshot == null
        ? { ok: false, error: "Deploy task not found." }
        : { ok: true, snapshot };
    },
  });

  const submitDeployTaskInputTool = tool({
    description:
      "Submit missing inputs for a blocked deploy task, such as environment variables, confirmations, or deployment choices.",
    inputSchema: submitDeployTaskInputToolInputSchema,
    execute: async (input) => {
      logChatToolIntention("submitDeployTaskInput", input.intention);
      const snapshot = await readTaskSnapshot(input.taskId, namespace);
      if (snapshot == null || snapshot.task.namespace !== namespace) {
        return { ok: false, error: "Deploy task not found." };
      }
      const result = await submitTaskInput(engineContext(), {
        actionActor,
        namespace,
        run: (handle, task, currentBlockingInputs, values) =>
          runTask(handle, {
            currentBlockingInputs,
            encodedKubeconfig,
            submittedInputValues: values,
            taskId: task.id,
          }),
        taskId: input.taskId,
        values: input.values,
      });
      switch (result.kind) {
        case "not-found":
          return { ok: false, error: "Deploy task not found." };
        case "conflict":
          return { ok: false, error: "Deploy task is not waiting for input." };
        case "invalid-input":
          return {
            ok: false,
            error: result.message,
          };
        case "resumed":
          return { ok: true, task: projectTask(result.task) };
        default:
          return result satisfies never;
      }
    },
  });

  const cancelDeployTaskTool = tool({
    description:
      "Cancel a SealAI deploy task. Use only when the user explicitly asks to stop or cancel the deploy task.",
    inputSchema: cancelDeployTaskToolInputSchema,
    execute: async (input) => {
      logChatToolIntention("cancelDeployTask", input.intention);
      const snapshot = await getDeployTaskSnapshot(input.taskId, namespace);
      if (snapshot == null || snapshot.task.namespace !== namespace) {
        return { ok: false, error: "Deploy task not found." };
      }
      const result = await cancelDeployTaskAction(
        getDeployTaskEngineContext(),
        { actionActor, namespace, taskId: input.taskId }
      );
      switch (result.kind) {
        case "not-found":
          return { ok: false, error: "Deploy task not found." };
        case "already-terminal":
          return {
            ok: false,
            error: `Deploy task already ${result.task.status}.`,
            task: toDeployTaskDTO(result.task),
          };
        case "cancelled":
        case "cancelling":
          return { ok: true, task: toDeployTaskDTO(result.task) };
        default:
          return result satisfies never;
      }
    },
  });

  return {
    cancelDeployTask: cancelDeployTaskTool,
    createDeployTask: createDeployTaskTool,
    getDeployTaskStatus: getDeployTaskStatusTool,
    submitDeployTaskInput: submitDeployTaskInputTool,
  };
}
