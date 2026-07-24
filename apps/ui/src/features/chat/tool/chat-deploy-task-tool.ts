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
  cancelDeployTaskAction,
  createDeployTaskAction,
  submitDeployTaskInputAction,
} from "@/features/deploy/task/engine/actions";
import { getDeployTaskEngineContext } from "@/features/deploy/task/engine/server";
import {
  resolveDeploymentTaskTarget,
  runDeployTask,
} from "@/features/deploy/task/runner";
import {
  getDeployTaskSnapshot,
  getDeployTaskTimelineSnapshot,
  toDeployTaskDTO,
} from "@/features/deploy/task/service";
import {
  type DeploymentTaskTarget,
  submitDeployTaskInputSchema,
} from "@/features/deploy/task/types";

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
  },
  dependencies: {
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
  const projectTask = dependencies.toDeployTaskDTO ?? toDeployTaskDTO;

  const createDeployTaskTool = tool({
    description: [
      "Create a long-running Deployment Task in SealAI.",
      "Use this when the user asks to deploy a Docker image, a database, a template, or a prompt.",
      "The task resolves or creates its target Project, runs the server-selected Deployment Runner, applies artifacts, and reports progress separately.",
      "Do not provide a runner; Docker and database sources use the Direct Runner, template sources use the Template Runner, and GitHub or prompt sources use the AI Runner.",
      "If the user is already inside a Project, omit target to deploy into the current Project; otherwise provide a newProject target.",
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
      if (input.source.kind === "github") {
        return {
          ok: false,
          error:
            "GitHub deployment creation is not available in Assistant tools. Use the GitHub deployment pane, which binds the verified Workspace Actor's connection.",
        };
      }

      const result = await createDeployTaskAction(engineContext(), {
        create: {
          createdFrom: "chat",
          creatingActor: actionActor,
          namespace,
          prompt: input.prompt,
          runner: defaultRunnerForSource(input.source),
          source: input.source,
          target,
        },
        resolveTarget: async (resolveInput) => {
          const resolved = await resolveDeploymentTaskTarget({
            id: "",
            namespace: resolveInput.namespace,
            projectId: null,
            projectName: null,
            target: resolveInput.target,
          });
          return {
            projectId: resolved.projectId,
            projectName: resolved.projectName,
          };
        },
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
