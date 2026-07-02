import { tool } from "ai";
import { z } from "zod";

import {
  resolveDeploymentTaskTarget,
  startDeployTaskRunner,
} from "@/lib/deploy-task/runner";
import {
  cancelDeployTask,
  createDeployTask,
  getDeployTaskSnapshot,
  submitDeployTaskInput,
} from "@/lib/deploy-task/service";
import {
  type DeploymentTaskTarget,
  submitDeployTaskInputSchema,
} from "@/lib/deploy-task/types";
import {
  createDeployTaskToolInputSchema,
  defaultRunnerForSource,
} from "@/lib/tool/chat-deploy-task-input";
import {
  chatToolIntentionField,
  logChatToolIntention,
} from "@/lib/tool/chat-tool-intention";

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

export function createDeployTaskTools(options: {
  assistantContext?: {
    projectName?: string;
    projectId?: string;
    selectedWorkload?: {
      kubernetesUid?: string;
      name?: string;
      kind?: string;
      namespace?: string;
    };
  };
  kubeconfig: string;
  kubernetesNamespace: string;
}) {
  const namespace = options.kubernetesNamespace;

  const createDeployTaskTool = tool({
    description: [
      "Create a long-running Deployment Task in SealAI.",
      "Use this when the user asks to deploy from GitHub, a Docker image, a database, a template, or a prompt.",
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
            "GitHub deployment from chat requires the Desktop user identity. Use the GitHub deployment pane for now.",
        };
      }

      const task = await createDeployTask({
        createdFrom: "chat",
        namespace,
        prompt: input.prompt,
        runner: defaultRunnerForSource(input.source),
        source: input.source,
        target,
      });
      const resolved = await resolveDeploymentTaskTarget({
        id: task.id,
        namespace,
        projectId: task.projectId,
        projectName: task.projectName,
        target,
      });
      const snapshot = await getDeployTaskSnapshot(task.id, namespace);
      startDeployTaskRunner({
        encodedKubeconfig: encodeURIComponent(options.kubeconfig),
        taskId: task.id,
      }).catch((error: unknown) => {
        console.error("[chat-deploy-task] runner failed:", error);
      });
      return {
        ok: true,
        task: snapshot?.task ?? {
          ...task,
          phase: "resolve-target",
          projectId: resolved.projectId,
          projectName: resolved.projectName,
          status: "running",
        },
        taskUrl: `/deploy-tasks/${task.id}`,
      };
    },
  });

  const getDeployTaskStatusTool = tool({
    description:
      "Get the current status, phase, recent events, and projected messages for a SealAI deploy task.",
    inputSchema: getDeployTaskStatusToolInputSchema,
    execute: async (input) => {
      logChatToolIntention("getDeployTaskStatus", input.intention);
      const snapshot = await getDeployTaskSnapshot(input.taskId, namespace);
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
      const snapshot = await getDeployTaskSnapshot(input.taskId, namespace);
      if (snapshot == null) {
        return { ok: false, error: "Deploy task not found." };
      }
      const task = await submitDeployTaskInput(input.taskId, {
        values: input.values,
      }).catch((error: unknown) => {
        if (
          error instanceof Error &&
          error.message === "Deploy task is not waiting for input."
        ) {
          return "not-waiting" as const;
        }
        throw error;
      });
      if (task === "not-waiting") {
        return {
          ok: false,
          error: "Deploy task is not waiting for input.",
        };
      }
      if (task != null) {
        startDeployTaskRunner({
          encodedKubeconfig: encodeURIComponent(options.kubeconfig),
          submittedInputValues: input.values,
          taskId: input.taskId,
        }).catch((error: unknown) => {
          console.error(
            "[chat-deploy-task] runner input resume failed:",
            error
          );
        });
      }
      return task == null
        ? { ok: false, error: "Deploy task not found." }
        : { ok: true, task };
    },
  });

  const cancelDeployTaskTool = tool({
    description:
      "Cancel a SealAI deploy task. Use only when the user explicitly asks to stop or cancel the deploy task.",
    inputSchema: cancelDeployTaskToolInputSchema,
    execute: async (input) => {
      logChatToolIntention("cancelDeployTask", input.intention);
      const snapshot = await getDeployTaskSnapshot(input.taskId, namespace);
      if (snapshot == null) {
        return { ok: false, error: "Deploy task not found." };
      }
      const task = await cancelDeployTask(input.taskId);
      return task == null
        ? { ok: false, error: "Deploy task not found." }
        : { ok: true, task };
    },
  });

  return {
    cancelDeployTask: cancelDeployTaskTool,
    createDeployTask: createDeployTaskTool,
    getDeployTaskStatus: getDeployTaskStatusTool,
    submitDeployTaskInput: submitDeployTaskInputTool,
  };
}
