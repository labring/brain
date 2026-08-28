import type { UIMessage } from "ai";

import { resolveDevMock } from "@/features/dev-mock/server/resolve";
import { HOUR_MS, MINUTE_MS } from "@/lib/time";

import { type ChatDevScenario, chatDevMockCookie } from "./dev-mock-cookie";
import type {
  AssistantSessionPayload,
  AssistantThreadDTO,
  FreeTierState,
} from "./persistence/types";
import { SELECTED_RESOURCE_CONTEXT_PART_TYPE } from "./persistence/types";

/**
 * Conversation dev fixtures: three threads' worth of transcript so the chat
 * pane can be designed against a real-looking history — tool cards in every
 * state, a pinned chat context, code blocks, a long scroll. The session and
 * message routes answer from here; the layer below (the real handler)
 * still decides the Chat Billing Mode when it can answer, so the billing
 * mock keeps driving it. Nothing here is ever written to Postgres.
 */

/** Anchored at module load so thread timestamps stay stable across reloads. */
const FIXTURE_NOW_MS = Date.now();

const THREAD_IDS = {
  empty: "mock-chat-empty",
  long: "mock-chat-long",
  short: "mock-chat-short",
} as const;

function at(agoMs: number): string {
  return new Date(FIXTURE_NOW_MS - agoMs).toISOString();
}

function user(
  id: string,
  text: string,
  extraParts: UIMessage["parts"] = []
): UIMessage {
  return { id, parts: [...extraParts, { text, type: "text" }], role: "user" };
}

function assistant(id: string, parts: UIMessage["parts"]): UIMessage {
  return { id, parts, role: "assistant" };
}

const SHORT_TRANSCRIPT: UIMessage[] = [
  user("m1", "How do I expose my app on a custom domain?"),
  assistant("m2", [
    { type: "step-start" },
    {
      text: "You can attach a custom domain in three steps:\n\n1. Add the domain under **Networking → Domains**.\n2. Point a `CNAME` record at the generated target.\n3. Wait for the TLS certificate to be issued.\n\nOnce the certificate is **Ready**, traffic resolves automatically.",
      type: "text",
    },
  ]),
  user("m3", "What if the certificate stays pending?"),
  assistant("m4", [
    { type: "step-start" },
    {
      text: "A pending certificate almost always means the `CNAME` has not propagated yet. Verify it with:\n\n```bash\ndig +short CNAME app.example.com\n```\n\nIf the target does not match, fix the DNS record and re-check in a few minutes.",
      type: "text",
    },
  ]),
];

const LONG_TRANSCRIPT: UIMessage[] = [
  user(
    "l1",
    "Deploy acme/web-app from GitHub into this project. It needs a Postgres database."
  ),
  assistant("l2", [
    { type: "step-start" },
    {
      text: "I'll look at the repository first, then plan the resources.",
      type: "text",
    },
    {
      input: { kind: "AP", name: "web-app", namespace: "ns-mock" },
      output: { found: false },
      state: "output-available",
      toolCallId: "call-read-1",
      type: "tool-readProductResource",
    },
    { type: "step-start" },
    {
      text: "There's no `web-app` workload yet, so this will be a fresh deployment. The repo is a Next.js app with a `DATABASE_URL` dependency. Here's the plan:\n\n| Resource | Kind | Notes |\n|---|---|---|\n| `web-app` | AP | Node 20, 1 replica, port 3000 |\n| `pg-main` | DB | PostgreSQL 16, 1 Gi |\n| `web-app` | Public Access | HTTPS on the platform domain |\n\nShall I create the database first?",
      type: "text",
    },
  ]),
  user("l3", "Yes, go ahead."),
  assistant("l4", [
    { type: "step-start" },
    {
      approval: { approved: true, id: "approval-db-1" },
      input: {
        intention: "create the PostgreSQL cluster web-app depends on",
        kind: "DB",
        name: "pg-main",
        operation: "create",
        spec: { storageGi: 1, type: "postgresql", version: "16" },
      },
      output: { name: "pg-main", status: "Creating" },
      state: "output-available",
      toolCallId: "call-write-db",
      type: "tool-writeProductResource",
    },
    { type: "step-start" },
    {
      text: "`pg-main` is being created. I'll start a deployment task for the app while it comes up.",
      type: "text",
    },
    {
      input: {
        branch: "main",
        repo: "acme/web-app",
        target: "existingProject",
      },
      output: { status: "running", taskId: "mock-task-running" },
      state: "output-available",
      toolCallId: "call-deploy-1",
      type: "tool-startDeploymentTask",
    },
    { type: "step-start" },
    {
      text: "The deployment task is running — you can follow it in the timeline. I'll check back once the image is built.",
      type: "text",
    },
  ]),
  user("l5", "The build failed. What went wrong?", [
    {
      data: { kind: "AP", name: "web-app", namespace: "ns-mock" },
      type: SELECTED_RESOURCE_CONTEXT_PART_TYPE,
    },
  ]),
  assistant("l6", [
    { type: "step-start" },
    {
      input: { taskId: "mock-task-running" },
      output: {
        error: "Image build failed: `npm run build` exited with status 1.",
        reason: "image-build-failed",
        status: "failed",
      },
      state: "output-available",
      toolCallId: "call-task-1",
      type: "tool-readDeploymentTask",
    },
    {
      input: { container: "build", lines: 40, name: "web-app" },
      errorText: "Build logs are no longer available for this task.",
      state: "output-error",
      toolCallId: "call-logs-1",
      type: "tool-readWorkloadLogs",
    },
    { type: "step-start" },
    {
      text: "The build step failed with `npm run build` exiting 1, and the build logs have already been rotated. Two common causes for this repo shape:\n\n- a **TypeScript error** that `next build` treats as fatal;\n- a missing `NEXT_PUBLIC_*` variable the build reads at compile time.\n\nI can redeploy with `CI=false` to surface the exact error, or you can run `npm run build` locally first. Which do you prefer?",
      type: "text",
    },
  ]),
  user(
    "l7",
    "Redeploy, and set NEXT_PUBLIC_API_URL to https://api.example.com."
  ),
  assistant("l8", [
    { type: "step-start" },
    {
      approval: { approved: true, id: "approval-env-1" },
      input: {
        intention: "set the public API URL the build reads",
        kind: "AP",
        name: "web-app",
        operation: "patch",
        patch: { env: { NEXT_PUBLIC_API_URL: "https://api.example.com" } },
      },
      output: { applied: true },
      state: "output-available",
      toolCallId: "call-write-env",
      type: "tool-writeProductResource",
    },
    {
      input: { retriedFromTaskId: "mock-task-running" },
      output: { status: "running", taskId: "mock-task-succeeded" },
      state: "output-available",
      toolCallId: "call-deploy-2",
      type: "tool-startDeploymentTask",
    },
    { type: "step-start" },
    {
      text: "Environment updated and the redeploy is running. This time the build has the variable it needs.",
      type: "text",
    },
  ]),
  user("l9", "Is it up?"),
  assistant("l10", [
    { type: "step-start" },
    {
      input: { taskId: "mock-task-succeeded" },
      output: {
        resultUrl: "https://web-app.mock.sealos.run",
        status: "completed",
      },
      state: "output-available",
      toolCallId: "call-task-2",
      type: "tool-readDeploymentTask",
    },
    {
      input: { namespace: "ns-mock" },
      output: { scheduled: true },
      state: "output-available",
      toolCallId: "call-refresh-1",
      type: "tool-refreshFrontendSwrCaches",
    },
    { type: "step-start" },
    {
      text: "Yes — `web-app` is live at https://web-app.mock.sealos.run with 1/1 replicas ready, connected to `pg-main`. The canvas has been refreshed to show both resources.",
      type: "text",
    },
  ]),
  user("l11", "Scale it to 3 replicas and show me the resulting spec."),
  assistant("l12", [
    { type: "step-start" },
    {
      approval: { id: "approval-scale-1" },
      input: {
        intention: "scale web-app after showing the patch",
        kind: "AP",
        name: "web-app",
        operation: "patch",
        patch: { spec: { replicas: 3 } },
      },
      state: "approval-requested",
      toolCallId: "call-scale-1",
      type: "tool-writeProductResource",
    },
    { type: "step-start" },
    {
      text: "Here is the patch I'd apply:\n\n```yaml\nspec:\n  replicas: 3\n```\n\nApprove it and I'll scale `web-app` right away.",
      type: "text",
    },
  ]),
];

const TRANSCRIPTS: Record<string, UIMessage[]> = {
  [THREAD_IDS.empty]: [],
  [THREAD_IDS.long]: LONG_TRANSCRIPT,
  [THREAD_IDS.short]: SHORT_TRANSCRIPT,
};

function threads(namespace: string): AssistantThreadDTO[] {
  return [
    {
      id: THREAD_IDS.long,
      namespace,
      title: "Deploy acme/web-app from GitHub",
      updatedAt: at(12 * MINUTE_MS),
    },
    {
      id: THREAD_IDS.short,
      namespace,
      title: "Custom domain setup",
      updatedAt: at(3 * HOUR_MS),
    },
    {
      id: THREAD_IDS.empty,
      namespace,
      title: "New chat",
      updatedAt: at(26 * HOUR_MS),
    },
  ];
}

/** Every scenario shows the same three threads; the scenario picks which one is open. */
function scenarioSession(
  scenario: ChatDevScenario,
  namespace: string,
  freeTier: FreeTierState
): AssistantSessionPayload {
  const chatId = THREAD_IDS[scenario];
  return {
    chatId,
    freeTier,
    messages: TRANSCRIPTS[chatId] ?? [],
    threads: scenario === "empty" ? [] : threads(namespace),
  };
}

/** No allowance to speak of; the real handler's posture replaces it when it answers. */
const NEUTRAL_FREE_TIER: FreeTierState = {
  billing: "user",
  limit: 0,
  remaining: 0,
};

export type ChatDevMockHandler = "messages" | "session" | "threads";

export type ChatDevMockNext = (request: Request) => Promise<Response>;

function namespaceOf(request: Request): string {
  return (
    new URL(request.url).searchParams.get("namespace")?.trim() || "ns-mock"
  );
}

async function freeTierBelow(
  request: Request,
  next: ChatDevMockNext
): Promise<FreeTierState> {
  const below = await next(request).catch(() => null);
  if (below == null || !below.ok) {
    return NEUTRAL_FREE_TIER;
  }
  const payload: unknown = await below.json().catch(() => null);
  const freeTier =
    typeof payload === "object" && payload != null
      ? (payload as { freeTier?: unknown }).freeTier
      : null;
  return typeof freeTier === "object" && freeTier != null
    ? (freeTier as FreeTierState)
    : NEUTRAL_FREE_TIER;
}

/**
 * Answers a conversation persistence route from fixtures while the mock is
 * on; `next` is the real handler. The session keeps the real handler's
 * Chat Billing Mode when it can answer (so the billing mock still drives
 * it) and falls back to a neutral posture otherwise. Off hands the request
 * down untouched.
 */
export async function chatDevMockResponse(
  handler: ChatDevMockHandler,
  request: Request,
  next: ChatDevMockNext
): Promise<Response> {
  const resolution = resolveDevMock(chatDevMockCookie, request, "chat");
  if (resolution.kind === "off") {
    return next(request);
  }
  if (resolution.kind === "invalid") {
    return resolution.response;
  }
  const { scenario } = resolution;
  const namespace = namespaceOf(request);
  switch (handler) {
    case "session":
      return Response.json(
        scenarioSession(scenario, namespace, await freeTierBelow(request, next))
      );
    case "threads":
      return Response.json({
        threads: scenario === "empty" ? [] : threads(namespace),
      });
    case "messages": {
      const chatId = new URL(request.url).searchParams.get("chatId") ?? "";
      const messages = TRANSCRIPTS[chatId];
      return messages == null ? next(request) : Response.json({ messages });
    }
    default:
      return handler satisfies never;
  }
}
