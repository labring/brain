import { tool } from "ai";
import { z } from "zod";

import {
  chatToolIntentionField,
  logChatToolIntention,
} from "@/features/chat/tool/chat-tool-intention";

export const NAVIGATE_APP_TOOL_NAME = "navigateApp" as const;

/** Matches the project area in the App Router (`app/project`). */
export const NAVIGATION_PROJECT_INDEX_PATH = "/project" as const;

const PATH_QUERY_HASH_SPLIT = /[?#]/;
const NAVIGATE_APP_ERROR_MAX_LENGTH = 500;
const NAVIGATE_APP_PATH_MAX_LENGTH = 2048;

/**
 * Canonical in-app URLs for project navigation (for tool description + validation).
 */
export function describeProjectNavigationUrls(): string {
  return [
    `Open the project list: \`${NAVIGATION_PROJECT_INDEX_PATH}\`.`,
    `Open one project workspace (canvas): \`${NAVIGATION_PROJECT_INDEX_PATH}/<projectId>\` where \`<projectId>\` is the project’s stable id.`,
    `If the uid contains spaces or reserved URL characters, percent-encode path segments (example: \`${NAVIGATION_PROJECT_INDEX_PATH}/my%20project\`).`,
  ].join(" ");
}

export function buildNavigateAppToolDescription(): string {
  return [
    "Client-side navigation: change the visible route in this Next.js app using the browser router (no full page reload).",
    "Call when the user asks to open, go to, or switch between project screens.",
    describeProjectNavigationUrls(),
    `Only paths under ${NAVIGATION_PROJECT_INDEX_PATH} are accepted for safety.`,
    "Always include `intention`: one short clause explaining why navigating helps the user's goal.",
  ].join(" ");
}

export const navigateAppInputSchema = z.object({
  intention: chatToolIntentionField,
  path: z
    .string()
    .min(1)
    .max(NAVIGATE_APP_PATH_MAX_LENGTH)
    .describe(
      [
        "In-app pathname beginning with `/` (optionally including a `?query` or `#hash`).",
        describeProjectNavigationUrls(),
      ].join(" ")
    ),
});

export type NavigateAppInput = z.infer<typeof navigateAppInputSchema>;

export const navigateAppOutputSchema = z.discriminatedUnion("success", [
  z
    .object({
      path: z.string().min(1).max(NAVIGATE_APP_PATH_MAX_LENGTH),
      success: z.literal(true),
    })
    .strict(),
  z
    .object({
      error: z.string().min(1).max(NAVIGATE_APP_ERROR_MAX_LENGTH),
      success: z.literal(false),
    })
    .strict(),
]);

export type NavigateAppToolOutput = z.infer<typeof navigateAppOutputSchema>;

function assertSafeProjectPath(path: string): string | null {
  const trimmed = path.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return null;
  }
  if (trimmed.includes("://") || trimmed.includes("\\")) {
    return null;
  }
  const pathOnly = trimmed.split(PATH_QUERY_HASH_SPLIT, 1)[0] ?? trimmed;
  if (
    pathOnly !== NAVIGATION_PROJECT_INDEX_PATH &&
    !pathOnly.startsWith(`${NAVIGATION_PROJECT_INDEX_PATH}/`)
  ) {
    return null;
  }
  return trimmed;
}

/**
 * Runs in the browser from `useChat` `onToolCall`. `navigate` should be `router.push` (or equivalent).
 */
export function runNavigateAppTool(
  input: unknown,
  navigate: (href: string) => void
): NavigateAppToolOutput {
  const parsed = navigateAppInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }
  const safe = assertSafeProjectPath(parsed.data.path);
  if (safe == null) {
    return {
      success: false,
      error: `Refused: only ${NAVIGATION_PROJECT_INDEX_PATH} and ${NAVIGATION_PROJECT_INDEX_PATH}/… paths are allowed.`,
    };
  }
  logChatToolIntention("navigateApp", parsed.data.intention);
  navigate(safe);
  return { success: true, path: safe };
}

/**
 * Declared on `POST /api/chat` without `execute`; the UI handles it in `useChat` `onToolCall`
 * (`providerExecuted` stays false so the client runs navigation).
 */
export const navigateAppTool = tool({
  description: buildNavigateAppToolDescription(),
  inputSchema: navigateAppInputSchema,
  outputSchema: navigateAppOutputSchema,
});
