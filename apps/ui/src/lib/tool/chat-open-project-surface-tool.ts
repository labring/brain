import { tool } from "ai";
import { z } from "zod";
import type {
  ProjectSidePaneAssistantIntent,
  ProjectSidePaneAssistantRouter,
} from "@/features/project-surfaces/assistant-router";
import {
  chatToolIntentionField,
  logChatToolIntention,
} from "@/lib/tool/chat-tool-intention";

export const OPEN_PROJECT_SURFACE_TOOL_NAME = "openProjectSurface" as const;

const resourceNameField = z.string().trim().min(1).max(253);
const namespaceField = z.string().trim().min(1).max(253);

const apTargetSchema = z.object({
  kind: z.literal("AP"),
  name: resourceNameField,
  namespace: namespaceField,
  observedUid: z.string().trim().min(1).max(256).optional(),
});

const dbTargetSchema = z.object({
  kind: z.literal("DB"),
  name: resourceNameField,
  namespace: namespaceField,
  observedUid: z.string().trim().min(1).max(256).optional(),
});

const publicAccessTargetSchema = z.object({
  apName: resourceNameField,
  kind: z.literal("PublicAccess"),
  namespace: namespaceField,
  observedUid: z.string().trim().min(1).max(256).optional(),
});

const openProjectSurfaceInputSchema = z.object({
  intention: chatToolIntentionField,
  target: z
    .union([apTargetSchema, dbTargetSchema, publicAccessTargetSchema])
    .optional(),
  type: z.enum([
    "apEvents",
    "apHistory",
    "apMetrics",
    "apSettings",
    "apTerminal",
    "database",
    "dbAccess",
    "dbMetrics",
    "dbSettings",
    "dbTerminal",
    "docker",
    "github",
    "logs",
    "metrics",
    "publicAddresses",
    "template",
  ]),
});

export type OpenProjectSurfaceInput = z.infer<
  typeof openProjectSurfaceInputSchema
>;

export type OpenProjectSurfaceToolOutput =
  | { ok: true; status: "handled" | "ignored" }
  | { error: string; ok: false };

function toAssistantIntent(
  input: OpenProjectSurfaceInput
): ProjectSidePaneAssistantIntent | { error: string } {
  const type = input.type;
  if (
    type === "database" ||
    type === "docker" ||
    type === "github" ||
    type === "template"
  ) {
    return { type };
  }
  const target = input.target;
  if (target == null) {
    return { error: `${type} requires a target.` };
  }
  if (
    type === "apEvents" ||
    type === "apHistory" ||
    type === "apMetrics" ||
    type === "apSettings" ||
    type === "apTerminal"
  ) {
    return target.kind === "AP"
      ? { target, type }
      : { error: `${type} requires an AP target.` };
  }
  if (
    type === "dbAccess" ||
    type === "dbMetrics" ||
    type === "dbSettings" ||
    type === "dbTerminal"
  ) {
    return target.kind === "DB"
      ? { target, type }
      : { error: `${type} requires a DB target.` };
  }
  if (type === "logs" || type === "metrics") {
    return target.kind === "AP" || target.kind === "DB"
      ? { target, type }
      : { error: `${type} requires an AP or DB target.` };
  }
  return target.kind === "PublicAccess"
    ? { target, type }
    : { error: `${type} requires a PublicAccess target.` };
}

export async function runOpenProjectSurfaceTool(
  input: unknown,
  router: Pick<ProjectSidePaneAssistantRouter, "openAssistantIntent">
): Promise<OpenProjectSurfaceToolOutput> {
  const parsed = openProjectSurfaceInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: parsed.error.issues.map((issue) => issue.message).join("; "),
      ok: false,
    };
  }

  logChatToolIntention(OPEN_PROJECT_SURFACE_TOOL_NAME, parsed.data.intention);
  const intent = toAssistantIntent(parsed.data);
  if ("error" in intent) {
    return {
      error: intent.error,
      ok: false,
    };
  }

  try {
    const result = await router.openAssistantIntent(intent);
    return { ok: true, status: result.status };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Project surface router failed.",
      ok: false,
    };
  }
}

function buildOpenProjectSurfaceToolDescription(): string {
  return [
    "Open a concrete Sealos Brain project surface in the user's browser tab.",
    "Use after selecting the relevant project/AP/DB/PublicAccess target, or when the user asks to open settings, logs, metrics, terminal, database access, public addresses, GitHub deploy, Docker deploy, database deploy, or template deploy.",
    "For deploy task status, use the server-side getDeployTaskStatus tool instead of this browser surface tool.",
    "For AP settings, terminal, logs, events, history, and metrics, pass an AP target. For DB settings, access, terminal, logs, and metrics, pass a DB target. For public addresses, pass a PublicAccess target bound to the AP name.",
    "This is a UI navigation/orchestration tool only; it does not mutate product resources.",
    "Always include `intention`: one short clause explaining why opening that surface helps.",
  ].join(" ");
}

/**
 * Declared on `POST /api/chat` without `execute`; handled in `useChat` `onToolCall`
 * so only the active browser tab opens project UI surfaces.
 */
export const openProjectSurfaceTool = tool({
  description: buildOpenProjectSurfaceToolDescription(),
  inputSchema: openProjectSurfaceInputSchema,
});
