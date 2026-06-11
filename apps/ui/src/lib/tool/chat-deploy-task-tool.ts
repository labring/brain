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
  type DeploymentTaskRunner,
  type DeploymentTaskSource,
  type DeploymentTaskTarget,
  deploymentTaskRunnerSchema,
  deploymentTaskSourceSchema,
  deploymentTaskTargetSchema,
  submitDeployTaskInputSchema,
} from "@/lib/deploy-task/types";
import {
  chatToolIntentionField,
  logChatToolIntention,
} from "@/lib/tool/chat-tool-intention";

const createDeployTaskToolInputSchema = z.object({
  intention: chatToolIntentionField,
  prompt: z.string().trim().max(4000).optional(),
  runner: deploymentTaskRunnerSchema.optional(),
  source: deploymentTaskSourceSchema,
  target: deploymentTaskTargetSchema.optional(),
});

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

function defaultRunnerForSource(
  source: DeploymentTaskSource
): DeploymentTaskRunner {
  switch (source.kind) {
    case "database":
    case "docker":
      return { kind: "direct" };
    case "github":
    case "prompt":
      return {
        kind: "ai",
        runtimeProvider: "devbox",
        skill: "brain-github-deploy",
      };
    case "template":
      return { kind: "template" };
    default:
      return source satisfies never;
  }
}

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
      "The task resolves or creates its target Project, runs the selected runner, applies artifacts, and reports progress separately.",
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

      const task = await createDeployTask({
        createdFrom: "chat",
        namespace,
        prompt: input.prompt,
        runner: input.runner ?? defaultRunnerForSource(input.source),
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
      startDeployTaskRunner({
        encodedKubeconfig: encodeURIComponent(options.kubeconfig),
        taskId: task.id,
      }).catch((error: unknown) => {
        console.error("[chat-deploy-task] runner failed:", error);
      });
      return {
        ok: true,
        task: {
          ...task,
          projectId: resolved.projectId,
          projectName: resolved.projectName,
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
      });
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
