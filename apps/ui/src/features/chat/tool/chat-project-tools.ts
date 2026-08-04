import { tool } from "ai";
import { z } from "zod";
import {
  deleteManagedProject,
  getManagedProject,
  listManagedProjects,
  previewManagedProjectDeletion,
} from "@/lib/project-persistence/project-management";

import {
  chatToolIntentionField,
  logChatToolIntention,
} from "./chat-tool-intention";

const projectIdSchema = z.string().trim().min(1).max(256);

const listProjectsInputSchema = z.object({
  intention: chatToolIntentionField,
});

const getProjectInputSchema = z.object({
  intention: chatToolIntentionField,
  projectId: projectIdSchema,
});

const previewProjectDeletionInputSchema = z.object({
  intention: chatToolIntentionField,
  projectId: projectIdSchema,
});

export const deleteProjectInputSchema = z.object({
  intention: chatToolIntentionField,
  previewId: projectIdSchema,
  projectId: projectIdSchema,
});

export function createChatProjectTools(options: {
  chatId: string;
  kubeconfig: string;
  kubernetesNamespace: string;
  workspaceUserUid: string;
}) {
  const actor = {
    actorUid: options.workspaceUserUid,
    chatId: options.chatId,
    encodedKubeconfig: encodeURIComponent(options.kubeconfig),
    namespace: options.kubernetesNamespace,
  };

  const listProjectsTool = tool({
    description: [
      "List the Projects accessible in the current authorized namespace.",
      "Use this before selecting a Project by name. Return IDs are the only valid targets for subsequent Project tools.",
      "Never assume a Project name maps to a target without first listing or reading it.",
    ].join(" "),
    inputSchema: listProjectsInputSchema,
    execute: async (input) => {
      logChatToolIntention("listProjects", input.intention);
      return { ok: true, projects: await listManagedProjects(actor) };
    },
  });

  const getProjectTool = tool({
    description: [
      "Read one Project by stable Project ID in the current authorized namespace.",
      "Use before previewing or managing a Project. A missing result means the ID is not available in this namespace.",
    ].join(" "),
    inputSchema: getProjectInputSchema,
    execute: async (input) => {
      logChatToolIntention("getProject", input.intention);
      const project = await getManagedProject({
        namespace: actor.namespace,
        projectId: input.projectId,
      });
      return project === null
        ? { error: "Project not found in the current namespace.", ok: false }
        : { ok: true, project };
    },
  });

  const previewProjectDeletionTool = tool({
    description: [
      "Create a live deletion preview for one Project ID.",
      "Use only after getProject. The output names every managed resource that deletion would remove and is valid for 10 minutes.",
      "Show the Project display name and complete resource summary to the user before calling deleteProject.",
    ].join(" "),
    inputSchema: previewProjectDeletionInputSchema,
    execute: async (input) => {
      logChatToolIntention("previewProjectDeletion", input.intention);
      const preview = await previewManagedProjectDeletion(
        actor,
        input.projectId
      );
      return preview === null
        ? { error: "Project not found in the current namespace.", ok: false }
        : { ok: true, preview };
    },
  });

  const deleteProjectTool = tool({
    description: [
      "Delete exactly the Project represented by a current deletion preview.",
      "Call only after previewProjectDeletion and after the user has requested deletion of that exact Project.",
      "Copy previewId and projectId from the preview output; the server owns the display name and resource summary.",
      "Execution requires a final browser approval and rechecks the Project and resource summary before any deletion.",
    ].join(" "),
    inputSchema: deleteProjectInputSchema,
    needsApproval: true,
    execute: async (input) => {
      logChatToolIntention("deleteProject", input.intention);
      const result = await deleteManagedProject({
        actor,
        previewId: input.previewId,
        projectId: input.projectId,
      });
      if (!result.ok) {
        return result;
      }
      return {
        ...result,
        refreshRequired: true,
      };
    },
  });

  return {
    deleteProject: deleteProjectTool,
    getProject: getProjectTool,
    listProjects: listProjectsTool,
    previewProjectDeletion: previewProjectDeletionTool,
  };
}
