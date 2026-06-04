import { tool } from "ai";
import { z } from "zod";

import { startDeployTaskRunner } from "@/lib/deploy-task/runner";
import {
  cancelDeployTask,
  createDeployTask,
  getDeployTaskSnapshot,
  submitDeployTaskInput,
} from "@/lib/deploy-task/service";
import {
  createDeployTaskInputSchema,
  submitDeployTaskInputSchema,
} from "@/lib/deploy-task/types";
import {
  chatToolIntentionField,
  logChatToolIntention,
} from "@/lib/tool/chat-tool-intention";

const repoSchema = createDeployTaskInputSchema.shape.repo;

const createDeployTaskToolInputSchema = z.object({
  branch: z.string().trim().max(256).optional(),
  intention: chatToolIntentionField,
  projectName: z.string().trim().max(512).optional(),
  projectId: z.string().trim().max(256).optional(),
  prompt: z.string().trim().max(4000).optional(),
  repo: repoSchema,
  selectedWorkloadUid: z.string().trim().max(256).optional(),
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
  kubernetesNamespace: string;
}) {
  const namespace = options.kubernetesNamespace;

  const createDeployTaskTool = tool({
    description: [
      "Create a long-running GitHub repository deploy task in SealAI.",
      "Use this when the user asks to deploy, ship, prepare, or turn a GitHub repository into a Sealos app.",
      "This only creates the task and starts the runner; it does not wait for the deploy to finish.",
      "Return the task id and tell the user that progress is tracked separately.",
    ].join(" "),
    inputSchema: createDeployTaskToolInputSchema,
    execute: async (input) => {
      logChatToolIntention("createDeployTask", input.intention);
      const task = await createDeployTask({
        branch: input.branch,
        namespace,
        projectName: input.projectName ?? options.assistantContext?.projectName,
        projectId: input.projectId ?? options.assistantContext?.projectId,
        prompt: input.prompt,
        repo: input.repo,
        selectedWorkloadUid:
          input.selectedWorkloadUid ??
          options.assistantContext?.selectedWorkload?.kubernetesUid,
      });
      startDeployTaskRunner({ taskId: task.id }).catch((error: unknown) => {
        console.error("[chat-deploy-task] runner failed:", error);
      });
      return {
        ok: true,
        task,
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
