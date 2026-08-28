import { beforeEach, expect, mock, spyOn, test } from "bun:test";
import { isDeepStrictEqual } from "node:util";
import { simulateReadableStream, tool, type UIMessage } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";
import { BILLING_JUDGMENT_TIMEOUT_MS } from "@/features/billing/server/judgment-budget";
import type { WorkspaceResourceQuotaSnapshot } from "@/features/billing/workspace-resource-quota";

const actualKubeconfig = { ...(await import("@/lib/kubeconfig")) };
const actualRequestKubeconfigAuth = {
  ...(await import("@/lib/request-kubeconfig-auth")),
};

const CHAT_ID = "chat-route-test";
const NAMESPACE = "ns-route-test";
const WORKSPACE_ACTOR = "workspace-actor-route-test";

const MOCK_USAGE = {
  inputTokens: {
    cacheRead: undefined,
    cacheWrite: undefined,
    noCache: 1,
    total: 1,
  },
  outputTokens: { reasoning: undefined, text: 1, total: 1 },
};

type StreamMode =
  | "abort"
  | "error"
  | "partial-abort"
  | "partial-error"
  | "partial-tool-error"
  | "success";
type TestStreamChunk =
  Awaited<
    ReturnType<MockLanguageModelV3["doStream"]>
  >["stream"] extends ReadableStream<infer Chunk>
    ? Chunk
    : never;

interface TestLease {
  chatId: string;
  messageId: string;
  parts: UIMessage["parts"];
  token: string;
}

interface TestOwner {
  namespace: string;
  userUid: string;
}

let activeLease: TestLease | null = null;
let adoptionCalls: { legacyWorkspaceActor: string; owner: TestOwner }[] = [];
let appendCalls: UIMessage[] = [];
let connectionAvailable = true;
let denyReservation: (() => void) | null = null;
let releaseCalls = 0;
let reserveCalls = 0;
let freeTierSnapshot = { limit: 5, remaining: 5, used: 0 };
let trialJudgment: "not-trial" | "trial" | "unknown" = "trial";
let billingStanding = {
  accountDebt: null as boolean | null,
  aiCredits: null as { totalMicroUnits: number; usedMicroUnits: number } | null,
  availableBalanceMicroUnits: null as number | null,
  fullQuota: null,
  paidSource: null as "ai-credits" | "balance" | null,
  quotaKnown: false,
};
let standingCalls: {
  userId: string | null;
  userUid: string;
  workspace: string;
}[] = [];
let connectionRefusal: { message: string; status: number } | null = null;
let workspaceResourceQuota: WorkspaceResourceQuotaSnapshot | undefined = {
  items: [
    { limit: 36_000, type: "cpu", used: 19_200 },
    { limit: 167_936, type: "memory", used: 26_880 },
    { limit: 204_800, type: "storage", used: 12_288 },
    { limit: 20, type: "pod", used: 3 },
    { limit: 10, type: "nodeport", used: 0 },
  ],
};
let judgmentCalls: {
  userId: string | null;
  userUid: string;
  workspace: string;
}[] = [];
let forceReplaceConflict = false;
let history: UIMessage[] = [];
let heartbeatTick: (() => void) | null = null;
let leaseAcquireCalls = 0;
let leaseAcquireMutation: (() => void) | null = null;
let leaseReleaseCalls = 0;
let leaseRenewCalls = 0;
let leaseRenewWait: Promise<TestLease | null> | null = null;
let modelCalls = 0;
let modelAbortSignals: (AbortSignal | undefined)[] = [];
let modelPrompts: unknown[] = [];
let modelProviderOptions: unknown[] = [];
let persistedLease: TestLease | null = null;
let replaceCalls = 0;
let streamMode: StreamMode = "success";
let serviceOwners: TestOwner[] = [];
let titleCalls = 0;
let titleWait: Promise<void> | null = null;
let toolsetAvailable = true;
let toolsetOwner: { namespace: string; workspaceActor: string } | null = null;
let transformSetup: (() => void) | null = null;

const clientTool = tool({
  description: "Test client navigation tool",
  inputSchema: z.object({ intention: z.string(), path: z.string() }),
  outputSchema: z.union([
    z.object({ path: z.string(), success: z.literal(true) }),
    z.object({ error: z.string(), success: z.literal(false) }),
  ]),
});

const serverTool = tool({
  description: "Test deployment status tool",
  inputSchema: z.object({ taskId: z.string() }),
  outputSchema: z.object({ status: z.string() }),
});

function streamChunksForMode(mode: StreamMode): TestStreamChunk[] {
  const textChunks = [
    { id: "text-1", type: "text-start" as const },
    {
      delta: "Recovered response",
      id: "text-1",
      type: "text-delta" as const,
    },
    { id: "text-1", type: "text-end" as const },
  ];

  switch (mode) {
    case "abort":
    case "partial-abort":
      return [];
    case "error":
      return [{ error: new Error("upstream failed"), type: "error" as const }];
    case "partial-error":
      return [
        ...textChunks,
        {
          error: new Error("upstream failed late"),
          type: "error" as const,
        },
      ];
    case "partial-tool-error":
      return [
        ...textChunks,
        {
          id: "partial-tool",
          toolName: "navigateApp",
          type: "tool-input-start" as const,
        },
        {
          delta: '{"intention":"unfinished',
          id: "partial-tool",
          type: "tool-input-delta" as const,
        },
        {
          error: new Error("upstream failed during tool input"),
          type: "error" as const,
        },
      ];
    case "success":
      return [
        ...textChunks,
        {
          finishReason: {
            raw: undefined,
            unified: "stop" as const,
          },
          type: "finish" as const,
          usage: MOCK_USAGE,
        },
      ];
    default:
      return mode satisfies never;
  }
}

function testModel() {
  return new MockLanguageModelV3({
    doStream: (options) => {
      modelCalls += 1;
      modelAbortSignals.push(options.abortSignal);
      modelPrompts.push(options.prompt);
      modelProviderOptions.push(options.providerOptions);

      if (streamMode === "abort" || streamMode === "partial-abort") {
        const signal = options.abortSignal;
        return Promise.resolve({
          stream: new ReadableStream<TestStreamChunk>({
            start(controller) {
              const abort = () => controller.error(signal?.reason);
              if (signal?.aborted) {
                abort();
                return;
              }
              if (streamMode === "partial-abort") {
                for (const chunk of streamChunksForMode("success").slice(
                  0,
                  -1
                )) {
                  controller.enqueue(chunk);
                }
              }
              signal?.addEventListener("abort", abort, { once: true });
            },
          }),
        });
      }

      return Promise.resolve({
        stream: simulateReadableStream({
          chunks: streamChunksForMode(streamMode),
        }),
      });
    },
  });
}

function persistToHistory(message: UIMessage): void {
  appendCalls.push(structuredClone(message));
  const existing = history.findIndex((item) => item.id === message.id);
  if (existing === -1) {
    history.push(structuredClone(message));
  } else {
    history[existing] = structuredClone(message);
  }
}

mock.module("server-only", () => ({}));
mock.module("@/features/chat/ai-proxy/resolve-chat-open-ai-connection", () => ({
  resolveChatOpenAiConnection: () => {
    if (connectionRefusal != null) {
      return Promise.resolve({ ...connectionRefusal, ok: false as const });
    }
    if (!connectionAvailable) {
      return Promise.resolve({
        message: "AI connection unavailable",
        ok: false as const,
        status: 503,
      });
    }
    return Promise.resolve({ connection: {}, ok: true as const });
  },
}));
mock.module("@/features/billing/server/free-trial-judgment", () => ({
  judgeActiveFreeTrialForWorkspace: (input: {
    userId: string | null;
    userUid: string;
    workspace: string;
  }) => {
    judgmentCalls.push({
      userId: input.userId,
      userUid: input.userUid,
      workspace: input.workspace,
    });
    return Promise.resolve(trialJudgment);
  },
}));
mock.module("@/features/billing/server/billing-standing", () => ({
  judgeWorkspaceBillingStandingForActor: (input: {
    userId: string | null;
    userUid: string;
    workspace: string;
  }) => {
    standingCalls.push({
      userId: input.userId,
      userUid: input.userUid,
      workspace: input.workspace,
    });
    return Promise.resolve({ ...billingStanding });
  },
}));
mock.module("@/features/chat/persistence/free-tier", () => ({
  getFreeTierSnapshot: () => Promise.resolve({ ...freeTierSnapshot }),
  isSystemOpenAiConfigured: () => true,
  releaseReservedFreeTurn: () => {
    releaseCalls += 1;
    freeTierSnapshot = {
      ...freeTierSnapshot,
      remaining: freeTierSnapshot.remaining + 1,
      used: freeTierSnapshot.used - 1,
    };
    return Promise.resolve();
  },
  reserveFreeTurnIfAvailable: () => {
    reserveCalls += 1;
    if (denyReservation != null) {
      denyReservation();
      return Promise.resolve(false);
    }
    if (freeTierSnapshot.remaining <= 0) {
      return Promise.resolve(false);
    }
    freeTierSnapshot = {
      ...freeTierSnapshot,
      remaining: freeTierSnapshot.remaining - 1,
      used: freeTierSnapshot.used + 1,
    };
    return Promise.resolve(true);
  },
}));
mock.module("@/features/chat/persistence/service", () => ({
  adoptLegacyAssistantConversationsForActor: (actor: {
    legacyWorkspaceActor: string;
    owner: TestOwner;
  }) => {
    adoptionCalls.push(structuredClone(actor));
    return Promise.resolve();
  },
  acquireChatStreamLease: (chatId: string, owner: TestOwner) => {
    serviceOwners.push(owner);
    leaseAcquireCalls += 1;
    if (activeLease != null) {
      return Promise.resolve(null);
    }
    const acquired = {
      chatId,
      messageId: `lease-${chatId}`,
      parts: [],
      token: `lease-token-${leaseAcquireCalls}`,
    };
    activeLease = acquired;
    leaseAcquireMutation?.();
    return Promise.resolve(acquired);
  },
  commitChatMessagesIfLeaseOwned: (input: {
    lease: TestLease;
    replacements: {
      expectedParts: UIMessage["parts"];
      messageId: string;
      replacementParts: UIMessage["parts"];
    }[];
    upsertMessage?: UIMessage;
  }) => {
    replaceCalls += input.replacements.length;
    if (activeLease?.token !== input.lease.token || forceReplaceConflict) {
      return Promise.resolve(null);
    }

    const nextHistory = structuredClone(history);
    for (const replacement of input.replacements) {
      const index = nextHistory.findIndex(
        (message) =>
          message.id === replacement.messageId &&
          message.role === "assistant" &&
          isDeepStrictEqual(message.parts, replacement.expectedParts)
      );
      if (index === -1) {
        return Promise.resolve(null);
      }
      nextHistory[index] = {
        ...nextHistory[index],
        parts: structuredClone(replacement.replacementParts),
      } as UIMessage;
    }

    if (input.upsertMessage != null) {
      const message = structuredClone(input.upsertMessage);
      const index = nextHistory.findIndex((item) => item.id === message.id);
      if (index === -1) {
        nextHistory.push(message);
      } else {
        nextHistory[index] = message;
      }
      appendCalls.push(message);
    }
    history = nextHistory;
    return Promise.resolve(input.lease);
  },
  ensureAssistantThreadForOwner: (
    _chatId: string,
    actor: { legacyWorkspaceActor: string; owner: TestOwner }
  ) => {
    serviceOwners.push(actor.owner);
    return Promise.resolve(true);
  },
  isReservedChatMessageId: (messageId: string) =>
    messageId.startsWith("__chat_stream_lease__:"),
  loadMessagesForOwner: (_chatId: string, owner: TestOwner) => {
    serviceOwners.push(owner);
    return Promise.resolve(structuredClone(history));
  },
  maybeAutoTitleThread: (input: { owner: TestOwner }) => {
    serviceOwners.push(input.owner);
    titleCalls += 1;
    return titleWait ?? Promise.resolve();
  },
  persistAssistantResponseIfLeaseOwned: (input: {
    lease: TestLease;
    message: UIMessage;
  }) => {
    persistedLease = input.lease;
    if (activeLease?.token !== input.lease.token) {
      return Promise.resolve(false);
    }
    persistToHistory(input.message);
    return Promise.resolve(true);
  },
  releaseOwnedChatStreamLease: (lease: TestLease) => {
    if (activeLease?.token !== lease.token) {
      return Promise.resolve(false);
    }
    activeLease = null;
    leaseReleaseCalls += 1;
    return Promise.resolve(true);
  },
  renewOwnedChatStreamLease: (lease: TestLease) => {
    leaseRenewCalls += 1;
    return leaseRenewWait ?? Promise.resolve(lease);
  },
}));
mock.module("@/features/chat/runtime/attach-tool-duration-metrics", () => ({
  attachToolDurationMetrics: (message: UIMessage) => message,
}));
mock.module("@/features/chat/runtime/inject-tool-duration-stream", () => ({
  createInjectToolDurationStreamTransform: () => {
    transformSetup?.();
    return undefined;
  },
}));
mock.module("@/features/chat/runtime/model", () => ({
  CHAT_MAX_STEPS: 15,
  chatLanguageModel: () => testModel(),
  threadTitleLanguageModel: () => testModel(),
}));
mock.module("@/features/chat/runtime/tools", () => ({
  buildChatToolset: (input: {
    kubernetesNamespace: string;
    workspaceActor: string;
  }) => {
    toolsetOwner = {
      namespace: input.kubernetesNamespace,
      workspaceActor: input.workspaceActor,
    };
    if (!toolsetAvailable) {
      return Promise.reject(new Error("toolset unavailable"));
    }
    return Promise.resolve({
      systemPrompt: "Test system prompt",
      tools: { getDeployTaskStatus: serverTool, navigateApp: clientTool },
    });
  },
}));
mock.module("@/lib/kubeconfig", () => ({
  ...actualKubeconfig,
  decodeKubeconfig: (encoded: string) =>
    encoded === "encoded-kubeconfig"
      ? "kubeconfig"
      : actualKubeconfig.decodeKubeconfig(encoded),
}));
mock.module("@/lib/request-kubeconfig-auth", () => ({
  ...actualRequestKubeconfigAuth,
  authorizeWorkspaceActor: (
    input: Parameters<
      typeof actualRequestKubeconfigAuth.authorizeWorkspaceActor
    >[0]
  ) => {
    if (input.encodedKubeconfig !== "encoded-kubeconfig") {
      return actualRequestKubeconfigAuth.authorizeWorkspaceActor(input);
    }
    // Mirrors the real choke point's fail-closed header contract so route
    // tests prove the header value reaches the authorization input.
    if (input.appToken !== "valid-app-token") {
      return Promise.resolve({
        code: "app_token_required" as const,
        message: "Authentication is required.",
        ok: false as const,
        status: 401,
      });
    }
    return Promise.resolve({
      actorBinding: {
        crName: WORKSPACE_ACTOR,
        mintedAt: null,
        userUid: `${WORKSPACE_ACTOR}-uid`,
      },
      namespace: NAMESPACE,
      ok: true as const,
      workspaceActor: WORKSPACE_ACTOR,
    });
  },
}));

const { POST } = await import("./route");

function pendingNavigationMessage(): UIMessage {
  return {
    id: "assistant-navigation",
    parts: [
      {
        input: { intention: "open the project", path: "/project" },
        state: "input-available",
        toolCallId: "call-navigation",
        type: "tool-navigateApp",
      },
    ],
    role: "assistant",
  };
}

function completedNavigationMessage(
  input: { intention: string; path: string } = {
    intention: "open the project",
    path: "/project",
  }
): UIMessage {
  return {
    id: "assistant-navigation",
    parts: [
      {
        input,
        output: { path: "/project", success: true },
        state: "output-available",
        toolCallId: "call-navigation",
        type: "tool-navigateApp",
      },
    ],
    role: "assistant",
  };
}

function pendingNavigationAfterMeasuredServerTool(): UIMessage {
  return {
    id: "assistant-navigation-after-server-tool",
    parts: [
      { type: "step-start" },
      {
        input: { taskId: "task-1" },
        output: { status: "running" },
        state: "output-available",
        toolCallId: "call-server-tool",
        toolMetadata: { durationMs: 125 },
        type: "tool-getDeployTaskStatus",
      },
      { type: "step-start" },
      {
        input: { intention: "open the project", path: "/project" },
        state: "input-available",
        toolCallId: "call-navigation",
        type: "tool-navigateApp",
      },
    ],
    role: "assistant",
  };
}

function completedNavigationWithoutServerToolMetadata(): UIMessage {
  const pending = pendingNavigationAfterMeasuredServerTool();
  return {
    ...pending,
    parts: pending.parts.map((part) => {
      if (part.type === "tool-getDeployTaskStatus") {
        const { toolMetadata: _toolMetadata, ...partWithoutMetadata } = part;
        return partWithoutMetadata;
      }
      if (part.type === "tool-navigateApp") {
        return {
          input: part.input,
          output: { path: "/project", success: true },
          state: "output-available" as const,
          toolCallId: part.toolCallId,
          type: part.type,
        };
      }
      return part;
    }),
  };
}

function pendingApprovalMessage(): UIMessage {
  return {
    id: "assistant-approval",
    parts: [
      {
        approval: { id: "approval-write" },
        input: {
          intention: "scale the deployment",
          operation: "patch",
        },
        state: "approval-requested",
        toolCallId: "call-write",
        type: "tool-writeProductResource",
      },
    ],
    role: "assistant",
  };
}

function pendingServerToolMessage(
  state: "input-available" | "input-streaming" = "input-available"
): UIMessage {
  return {
    id: "assistant-server-tool",
    parts: [
      {
        input: { taskId: "task-1" },
        state,
        toolCallId: "call-server-tool",
        type: "tool-getDeployTaskStatus",
      },
    ],
    role: "assistant",
  } as UIMessage;
}

function approvedMessage(): UIMessage {
  return {
    id: "assistant-approval",
    parts: [
      {
        approval: { approved: true, id: "approval-write" },
        input: {
          intention: "scale the deployment",
          operation: "patch",
        },
        state: "approval-responded",
        toolCallId: "call-write",
        type: "tool-writeProductResource",
      },
    ],
    role: "assistant",
  };
}

function userMessage(id: string, text: string): UIMessage {
  return { id, parts: [{ text, type: "text" }], role: "user" };
}

function chatRequest(
  message: UIMessage,
  signal?: AbortSignal,
  options?: {
    appToken?: string | null;
    workspaceResourceQuota?: unknown;
  }
): Request {
  const appToken =
    options?.appToken === undefined ? "valid-app-token" : options.appToken;
  return new Request("https://brain.test/api/chat", {
    body: JSON.stringify({
      chatId: CHAT_ID,
      encodedKubeconfig: "encoded-kubeconfig",
      message,
      namespace: NAMESPACE,
      ...(options?.workspaceResourceQuota === undefined
        ? { workspaceResourceQuota }
        : { workspaceResourceQuota: options.workspaceResourceQuota }),
    }),
    headers: {
      "content-type": "application/json",
      ...(appToken == null ? {} : { "X-Sealos-App-Token": appToken }),
    },
    method: "POST",
    ...(signal == null ? {} : { signal }),
  });
}

test("chat POST fails closed with 401 when the app token header is missing", async () => {
  const response = await POST(
    chatRequest(userMessage("user-no-app-token", "hello"), undefined, {
      appToken: null,
    })
  );

  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({
    code: "app_token_required",
    error: "Authentication is required.",
  });
});

async function drain(response: Response): Promise<void> {
  await response.arrayBuffer();
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("condition was not reached");
}

beforeEach(() => {
  activeLease = null;
  adoptionCalls = [];
  appendCalls = [];
  connectionAvailable = true;
  connectionRefusal = null;
  billingStanding = {
    accountDebt: null,
    aiCredits: null,
    availableBalanceMicroUnits: null,
    fullQuota: null,
    paidSource: null,
    quotaKnown: false,
  };
  standingCalls = [];
  denyReservation = null;
  releaseCalls = 0;
  reserveCalls = 0;
  forceReplaceConflict = false;
  freeTierSnapshot = { limit: 5, remaining: 5, used: 0 };
  workspaceResourceQuota = {
    items: [
      { limit: 36_000, type: "cpu", used: 19_200 },
      { limit: 167_936, type: "memory", used: 26_880 },
      { limit: 204_800, type: "storage", used: 12_288 },
      { limit: 20, type: "pod", used: 3 },
      { limit: 10, type: "nodeport", used: 0 },
    ],
  };
  history = [];
  judgmentCalls = [];
  trialJudgment = "trial";
  heartbeatTick = null;
  leaseAcquireCalls = 0;
  leaseAcquireMutation = null;
  leaseReleaseCalls = 0;
  leaseRenewCalls = 0;
  leaseRenewWait = null;
  modelCalls = 0;
  modelAbortSignals = [];
  modelPrompts = [];
  modelProviderOptions = [];
  persistedLease = null;
  replaceCalls = 0;
  serviceOwners = [];
  streamMode = "success";
  titleCalls = 0;
  titleWait = null;
  toolsetAvailable = true;
  toolsetOwner = null;
  transformSetup = null;
});

function interceptHeartbeatTimer() {
  const originalSetTimeout = globalThis.setTimeout;
  return spyOn(globalThis, "setTimeout").mockImplementation(((
    handler: TimerHandler,
    delay?: number,
    ...args: unknown[]
  ) => {
    if (delay === 60_000) {
      heartbeatTick = () => {
        if (typeof handler === "function") {
          handler(...args);
        }
      };
      return 2_147_483_000 as unknown as ReturnType<typeof setTimeout>;
    }
    return originalSetTimeout(handler, delay, ...args);
  }) as typeof setTimeout);
}

test("lease heartbeat loss aborts the stream without releasing a replacement lease", async () => {
  streamMode = "abort";
  leaseRenewWait = Promise.resolve(null);
  const timerSpy = interceptHeartbeatTimer();
  try {
    const response = await POST(
      chatRequest(userMessage("user-heartbeat-loss", "inspect the cluster"))
    );
    await waitUntil(() => modelAbortSignals.length === 1);

    activeLease = {
      chatId: CHAT_ID,
      messageId: `lease-${CHAT_ID}`,
      parts: [],
      token: "replacement-after-heartbeat-loss",
    };
    heartbeatTick?.();
    await response.arrayBuffer().catch(() => undefined);

    expect(leaseRenewCalls).toBe(1);
    expect(modelAbortSignals[0]?.aborted).toBe(true);
    expect(activeLease?.token).toBe("replacement-after-heartbeat-loss");
    expect(leaseReleaseCalls).toBe(0);
  } finally {
    timerSpy.mockRestore();
  }
});

test("finish waits for an in-flight heartbeat and persists with its latest lease", async () => {
  let finishHeartbeat: ((lease: TestLease | null) => void) | undefined;
  leaseRenewWait = new Promise<TestLease | null>((resolve) => {
    finishHeartbeat = resolve;
  });
  const timerSpy = interceptHeartbeatTimer();
  try {
    const response = await POST(
      chatRequest(userMessage("user-heartbeat-finish", "inspect the cluster"))
    );
    heartbeatTick?.();
    await waitUntil(() => leaseRenewCalls === 1);
    const drained = drain(response);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(persistedLease).toBeNull();
    expect(leaseReleaseCalls).toBe(0);
    const latestLease = {
      ...(activeLease as TestLease),
      parts: [{ text: "renewed-cas-snapshot", type: "text" as const }],
    };
    activeLease = latestLease;
    finishHeartbeat?.(latestLease);
    await drained;

    expect(persistedLease).toEqual(latestLease);
    expect(leaseReleaseCalls).toBe(1);
  } finally {
    timerSpy.mockRestore();
  }
});

test("accepts and streams a canonical client-tool continuation", async () => {
  history = [pendingNavigationMessage()];

  const response = await POST(chatRequest(completedNavigationMessage()));
  expect(response.status).toBe(200);
  await drain(response);

  expect(replaceCalls).toBe(1);
  expect(modelCalls).toBe(1);
  expect(reserveCalls).toBe(1);
  expect(releaseCalls).toBe(0);
  expect(titleCalls).toBe(1);
  expect(modelProviderOptions[0]).toEqual({
    openai: { reasoningEffort: "high" },
  });
  expect(JSON.stringify(modelPrompts[0])).toContain("call-navigation");
  expect(history).toHaveLength(1);
  expect(history[0]?.parts).toContainEqual(
    expect.objectContaining({
      state: "output-available",
      toolCallId: "call-navigation",
    })
  );
  expect(history[0]?.parts).toContainEqual(
    expect.objectContaining({ text: "Recovered response", type: "text" })
  );
  // Conversation ownership keys on the token-proven userUid (ADR-0059)…
  expect(serviceOwners).not.toHaveLength(0);
  expect(serviceOwners).toEqual(
    serviceOwners.map(() => ({
      namespace: NAMESPACE,
      userUid: `${WORKSPACE_ACTOR}-uid`,
    }))
  );
  // …while the toolset's deploy-task actor stays the per-region crName:
  // chat deploy tools perform only namespace-shared actions, which record
  // the kubeconfig-verified identity (AIM-154 keeps them token-free).
  expect(toolsetOwner).toEqual({
    namespace: NAMESPACE,
    workspaceActor: WORKSPACE_ACTOR,
  });
  expect(adoptionCalls).toEqual([
    {
      legacyWorkspaceActor: WORKSPACE_ACTOR,
      owner: { namespace: NAMESPACE, userUid: `${WORKSPACE_ACTOR}-uid` },
    },
  ]);
});

test("injects only the current workspace resources into the model prompt", async () => {
  const response = await POST(
    chatRequest(userMessage("user-usage-context", "how much usage is left?"))
  );
  expect(response.status).toBe(200);
  await drain(response);

  const prompt = JSON.stringify(modelPrompts[0]);
  expect(prompt).toContain("<workspace_resource_context");
  expect(prompt).toContain("CPU: 19.2C/36C");
  expect(prompt).toContain("Memory: 26.25Gi/164Gi");
  expect(prompt).toContain("Storage: 12Gi/200Gi");
  expect(prompt).toContain("Pods: 3/20");
  expect(prompt).toContain("CPU: 19.2C/36C");
  expect(prompt).toContain("Memory: 26.25Gi/164Gi");
  expect(prompt).toContain("Storage: 12Gi/200Gi");
  expect(prompt).toContain("Ports: 0/10");
  expect(prompt).toContain("Ports: 0/10");
  expect(prompt).not.toContain("assistant_usage_context");
  expect(prompt).not.toContain("Free assistant messages");
  expect(prompt).not.toContain("Billing mode for this turn");
  expect(prompt).not.toContain("AI Credits");
  expect(prompt).not.toContain("ai_quota");
});

test("keeps chat available when workspace resources are unavailable", async () => {
  workspaceResourceQuota = undefined;

  const response = await POST(
    chatRequest(userMessage("user-resource-unavailable", "show resources"))
  );
  expect(response.status).toBe(200);
  await drain(response);

  const prompt = JSON.stringify(modelPrompts[0]);
  expect(prompt).not.toContain("<workspace_resource_context");
});

test("keeps chat available when workspace resources are malformed", async () => {
  const response = await POST(
    chatRequest(
      userMessage("user-malformed-resource-context", "show resources"),
      undefined,
      {
        workspaceResourceQuota: {
          items: [{ limit: "36C", type: "cpu", used: 19_200 }],
        },
      }
    )
  );
  expect(response.status).toBe(200);
  await drain(response);

  const prompt = JSON.stringify(modelPrompts[0]);
  expect(prompt).not.toContain("<workspace_resource_context");
});

test("accepts a client-tool continuation without server-injected metadata", async () => {
  history = [pendingNavigationAfterMeasuredServerTool()];

  const response = await POST(
    chatRequest(completedNavigationWithoutServerToolMetadata())
  );
  expect(response.status).toBe(200);
  await drain(response);

  expect(replaceCalls).toBe(1);
  expect(modelCalls).toBe(1);
  expect(history[0]?.parts).toContainEqual(
    expect.objectContaining({
      toolCallId: "call-server-tool",
      toolMetadata: { durationMs: 125 },
    })
  );
  expect(history[0]?.parts).toContainEqual(
    expect.objectContaining({ text: "Recovered response", type: "text" })
  );
});

test("never binds the model stream to a wall-clock deadline", async () => {
  const timeoutController = new AbortController();
  const timeoutSpy = spyOn(AbortSignal, "timeout").mockReturnValue(
    timeoutController.signal
  );

  try {
    const response = await POST(
      chatRequest(userMessage("user-timeout", "inspect the cluster"))
    );
    expect(response.status).toBe(200);
    await drain(response);

    // The billing judgment's one budget (ADR-0068) and the auto-title
    // deadline are the only timers left; the turn itself ends on client
    // disconnect or lease loss, never on elapsed time.
    expect(timeoutSpy.mock.calls.flat()).toEqual([
      BILLING_JUDGMENT_TIMEOUT_MS,
      5000,
    ]);
    const modelSignal = modelAbortSignals[0];
    expect(modelSignal).toBeDefined();
    timeoutController.abort();
    expect(modelSignal?.aborted).toBe(false);
  } finally {
    timeoutSpy.mockRestore();
  }
});

test("request abort stops the model and releases the lease", async () => {
  streamMode = "abort";
  const requestController = new AbortController();
  const timeoutController = new AbortController();
  const timeoutSpy = spyOn(AbortSignal, "timeout").mockReturnValue(
    timeoutController.signal
  );

  try {
    const response = await POST(
      chatRequest(
        userMessage("user-abort", "inspect the cluster"),
        requestController.signal
      )
    );
    expect(response.status).toBe(200);
    expect(activeLease).not.toBeNull();
    await waitUntil(() => modelAbortSignals.length === 1);

    await response.body?.cancel();
    requestController.abort();
    await waitUntil(() => activeLease == null);

    expect(timeoutController.signal.aborted).toBe(false);
    expect(modelAbortSignals[0]?.aborted).toBe(true);
    expect(leaseReleaseCalls).toBe(1);
    expect(reserveCalls).toBe(1);
    expect(releaseCalls).toBe(1);
    expect(titleCalls).toBe(0);
    expect(history.filter((message) => message.role === "assistant")).toEqual(
      []
    );
  } finally {
    timeoutSpy.mockRestore();
  }
});

test("request abort persists partial text without billing", async () => {
  streamMode = "partial-abort";
  const requestController = new AbortController();
  const timeoutController = new AbortController();
  const timeoutSpy = spyOn(AbortSignal, "timeout").mockReturnValue(
    timeoutController.signal
  );

  try {
    const response = await POST(
      chatRequest(
        userMessage("user-partial-abort", "inspect the cluster"),
        requestController.signal
      )
    );
    expect(response.status).toBe(200);
    await waitUntil(() => modelAbortSignals.length === 1);

    await response.body?.cancel();
    requestController.abort();
    await waitUntil(() => activeLease == null);

    expect(timeoutController.signal.aborted).toBe(false);
    expect(leaseReleaseCalls).toBe(1);
    expect(reserveCalls).toBe(1);
    expect(releaseCalls).toBe(1);
    expect(titleCalls).toBe(0);
    expect(history.at(-1)?.parts).toContainEqual(
      expect.objectContaining({ text: "Recovered response", type: "text" })
    );
  } finally {
    timeoutSpy.mockRestore();
  }
});

test("releases the lease before waiting for automatic title generation", async () => {
  let finishTitle: (() => void) | undefined;
  titleWait = new Promise<void>((resolve) => {
    finishTitle = resolve;
  });

  const response = await POST(
    chatRequest(userMessage("user-title-wait", "inspect the cluster"))
  );
  const drained = drain(response);
  await waitUntil(() => titleCalls === 1);

  expect(activeLease).toBeNull();
  expect(leaseReleaseCalls).toBe(1);
  finishTitle?.();
  await drained;
});

test("preserves the existing approval continuation path through CAS", async () => {
  history = [pendingApprovalMessage()];

  const response = await POST(chatRequest(approvedMessage()));
  expect(response.status).toBe(200);
  await drain(response);

  expect(replaceCalls).toBe(1);
  expect(modelCalls).toBe(1);
  expect(JSON.stringify(modelPrompts[0])).toContain("call-write");
  expect(history[0]?.parts).toContainEqual(
    expect.objectContaining({
      approval: { approved: true, id: "approval-write" },
      state: "approval-responded",
      toolCallId: "call-write",
    })
  );
});

test("keeps an approval retryable when connection preflight fails", async () => {
  history = [pendingApprovalMessage()];
  connectionAvailable = false;

  const response = await POST(chatRequest(approvedMessage()));

  expect(response.status).toBe(503);
  expect(replaceCalls).toBe(0);
  expect(modelCalls).toBe(0);
  expect(reserveCalls).toBe(1);
  expect(releaseCalls).toBe(1);
  expect(history).toEqual([pendingApprovalMessage()]);

  connectionAvailable = true;
  const retryResponse = await POST(chatRequest(approvedMessage()));
  expect(retryResponse.status).toBe(200);
  await drain(retryResponse);
  expect(replaceCalls).toBe(1);
  expect(modelCalls).toBe(1);
});

test("keeps an approval retryable when toolset preflight fails", async () => {
  history = [pendingApprovalMessage()];
  toolsetAvailable = false;

  const response = await POST(chatRequest(approvedMessage()));

  expect(response.status).toBe(503);
  expect(replaceCalls).toBe(0);
  expect(modelCalls).toBe(0);
  expect(reserveCalls).toBe(1);
  expect(releaseCalls).toBe(1);
  expect(history).toEqual([pendingApprovalMessage()]);

  toolsetAvailable = true;
  const retryResponse = await POST(chatRequest(approvedMessage()));
  expect(retryResponse.status).toBe(200);
  await drain(retryResponse);
  expect(replaceCalls).toBe(1);
  expect(modelCalls).toBe(1);
});

test("recovers interrupted history while committing an approval", async () => {
  const incomplete = {
    ...pendingNavigationMessage(),
    id: "assistant-incomplete-history",
  };
  history = [incomplete, pendingApprovalMessage()];

  const response = await POST(chatRequest(approvedMessage()));

  expect(response.status).toBe(200);
  await drain(response);
  expect(replaceCalls).toBe(2);
  expect(leaseAcquireCalls).toBe(1);
  expect(modelCalls).toBe(1);
  expect(history[0]?.parts).toContainEqual(
    expect.objectContaining({
      state: "output-error",
      toolCallId: "call-navigation",
    })
  );
  expect(history[1]?.parts).toContainEqual(
    expect.objectContaining({
      approval: { approved: true, id: "approval-write" },
      state: "approval-responded",
      toolCallId: "call-write",
    })
  );
});

test("rejects forged client-tool input before CAS or model execution", async () => {
  history = [pendingNavigationMessage()];
  const forged = completedNavigationMessage({
    intention: "open a different project",
    path: "/project/forged",
  });

  const response = await POST(chatRequest(forged));

  expect(response.status).toBe(400);
  expect(replaceCalls).toBe(0);
  expect(modelCalls).toBe(0);
  expect(reserveCalls).toBe(1);
  expect(releaseCalls).toBe(1);
  expect(history).toEqual([pendingNavigationMessage()]);
});

test("rejects a stale or replayed client-tool continuation", async () => {
  history = [completedNavigationMessage()];

  const response = await POST(chatRequest(completedNavigationMessage()));

  expect(response.status).toBe(409);
  expect(modelCalls).toBe(0);
  expect(reserveCalls).toBe(1);
  expect(releaseCalls).toBe(1);
});

test("stops before the model when a concurrent continuation wins the CAS", async () => {
  history = [pendingNavigationMessage()];
  forceReplaceConflict = true;

  const response = await POST(chatRequest(completedNavigationMessage()));

  expect(response.status).toBe(409);
  expect(replaceCalls).toBe(1);
  expect(modelCalls).toBe(0);
  expect(reserveCalls).toBe(1);
  expect(releaseCalls).toBe(1);
  expect(history).toEqual([pendingNavigationMessage()]);
  expect(activeLease).toBeNull();
});

test("does not commit after the acquired lease is stolen", async () => {
  history = [pendingNavigationMessage()];
  leaseAcquireMutation = () => {
    activeLease = {
      chatId: CHAT_ID,
      messageId: `lease-${CHAT_ID}`,
      parts: [],
      token: "replacement-owner-before-commit",
    };
  };

  const response = await POST(chatRequest(completedNavigationMessage()));

  expect(response.status).toBe(409);
  expect(history).toEqual([pendingNavigationMessage()]);
  expect(modelCalls).toBe(0);
  expect(activeLease?.token).toBe("replacement-owner-before-commit");
  expect(leaseReleaseCalls).toBe(0);
});

test("rolls a continuation back when setup fails under the same lease", async () => {
  history = [pendingApprovalMessage()];
  transformSetup = () => {
    throw new Error("stream setup failed");
  };

  const response = await POST(chatRequest(approvedMessage()));

  expect(response.status).toBe(503);
  expect(history).toEqual([pendingApprovalMessage()]);
  expect(replaceCalls).toBe(2);
  expect(modelCalls).toBe(0);
  expect(activeLease).toBeNull();
  expect(leaseReleaseCalls).toBe(1);
});

test("does not roll a continuation back after its lease is stolen", async () => {
  history = [pendingApprovalMessage()];
  transformSetup = () => {
    activeLease = {
      chatId: CHAT_ID,
      messageId: `lease-${CHAT_ID}`,
      parts: [],
      token: "replacement-owner-before-rollback",
    };
    throw new Error("stream setup failed after takeover");
  };

  const response = await POST(chatRequest(approvedMessage()));

  expect(response.status).toBe(503);
  expect(history).toEqual([approvedMessage()]);
  expect(replaceCalls).toBe(2);
  expect(modelCalls).toBe(0);
  expect(activeLease?.token).toBe("replacement-owner-before-rollback");
  expect(leaseReleaseCalls).toBe(0);
});

test("holds the chat lease after continuation CAS until the stream finishes", async () => {
  history = [pendingNavigationMessage()];

  const continuation = await POST(chatRequest(completedNavigationMessage()));
  expect(continuation.status).toBe(200);
  expect(activeLease).not.toBeNull();

  const competingUser = userMessage(
    "user-during-continuation",
    "start another response"
  );
  const competing = await POST(chatRequest(competingUser));
  expect(competing.status).toBe(409);
  expect(history).not.toContainEqual(competingUser);
  expect(reserveCalls).toBe(2);
  expect(releaseCalls).toBe(1);

  await drain(continuation);
  expect(activeLease).toBeNull();
  expect(leaseReleaseCalls).toBe(1);
  expect(modelCalls).toBe(1);
  expect(reserveCalls).toBe(2);
  expect(releaseCalls).toBe(1);
});

test("rejects a request when history changes during runtime preflight", async () => {
  const concurrentMessage = userMessage(
    "user-concurrent-winner",
    "the preceding request committed"
  );
  leaseAcquireMutation = () => {
    history.push(concurrentMessage);
  };
  const incoming = userMessage("user-stale-snapshot", "use a stale prompt");

  const response = await POST(chatRequest(incoming));

  expect(response.status).toBe(409);
  expect(history).toEqual([concurrentMessage]);
  expect(activeLease).toBeNull();
  expect(leaseReleaseCalls).toBe(1);
  expect(modelCalls).toBe(0);
  expect(reserveCalls).toBe(1);
  expect(releaseCalls).toBe(1);
});

test("recovers an old incomplete client tool before processing a new user turn", async () => {
  history = [
    userMessage("user-original", "open the project"),
    pendingNavigationMessage(),
  ];

  const response = await POST(
    chatRequest(userMessage("user-follow-up", "continue the investigation"))
  );
  expect(response.status).toBe(200);
  await drain(response);

  expect(replaceCalls).toBe(1);
  expect(modelCalls).toBe(1);
  expect(history[1]?.parts).toContainEqual(
    expect.objectContaining({
      state: "output-error",
      toolCallId: "call-navigation",
    })
  );
  const prompt = JSON.stringify(modelPrompts[0]);
  expect(prompt).toContain("call-navigation");
  expect(prompt).toContain("continue the investigation");
});

test("recovers an old incomplete server tool before processing a new user turn", async () => {
  history = [
    userMessage("user-original", "check the deployment"),
    pendingServerToolMessage(),
  ];

  const response = await POST(
    chatRequest(userMessage("user-follow-up", "continue the investigation"))
  );
  expect(response.status).toBe(200);
  await drain(response);

  expect(replaceCalls).toBe(1);
  expect(modelCalls).toBe(1);
  expect(history[1]?.parts).toContainEqual(
    expect.objectContaining({
      errorText:
        "Tool execution was interrupted before a result was available.",
      state: "output-error",
      toolCallId: "call-server-tool",
    })
  );
});

test("rejects a new user turn with actionable guidance while approval is pending", async () => {
  history = [pendingApprovalMessage()];

  const response = await POST(
    chatRequest(userMessage("user-before-approval", "continue anyway"))
  );

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    code: "tool_approval_pending",
    error:
      "A tool approval is pending. Approve or deny it before sending a new message.",
  });
  expect(replaceCalls).toBe(0);
  expect(modelCalls).toBe(0);
});

test("rejects unrecoverable incomplete tool history with actionable guidance", async () => {
  history = [pendingServerToolMessage("input-streaming")];

  const response = await POST(
    chatRequest(userMessage("user-after-partial-input", "continue safely"))
  );

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    code: "incomplete_tool_history",
    error:
      "This conversation contains an incomplete tool call that cannot be recovered. Start a new chat to continue.",
  });
  expect(replaceCalls).toBe(0);
  expect(modelCalls).toBe(0);
});

test("recovers an approval left responded by a crashed continuation", async () => {
  history = [approvedMessage()];

  const response = await POST(
    chatRequest(userMessage("user-after-crash", "continue safely"))
  );
  expect(response.status).toBe(200);
  await drain(response);

  expect(replaceCalls).toBe(1);
  expect(modelCalls).toBe(1);
  expect(history[0]?.parts).toContainEqual(
    expect.objectContaining({
      state: "output-error",
      toolCallId: "call-write",
    })
  );
  expect(JSON.stringify(modelPrompts[0])).toContain("continue safely");
});

test("rejects a new user turn when continuation recovery loses the CAS", async () => {
  history = [
    userMessage("user-original", "open the project"),
    pendingNavigationMessage(),
  ];
  forceReplaceConflict = true;

  const response = await POST(
    chatRequest(userMessage("user-follow-up", "continue the investigation"))
  );

  expect(response.status).toBe(409);
  expect(replaceCalls).toBe(1);
  expect(appendCalls).toHaveLength(0);
  expect(modelCalls).toBe(0);
  expect(reserveCalls).toBe(1);
  expect(releaseCalls).toBe(1);
  expect(history).toEqual([
    userMessage("user-original", "open the project"),
    pendingNavigationMessage(),
  ]);
});

test("does not persist or bill an empty assistant response on stream error", async () => {
  streamMode = "error";

  const response = await POST(
    chatRequest(userMessage("user-error", "inspect the cluster"))
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("X-Chat-Free-Remaining")).toBe("4");
  await drain(response);

  expect(history).toEqual([userMessage("user-error", "inspect the cluster")]);
  expect(appendCalls).toHaveLength(1);
  expect(reserveCalls).toBe(1);
  expect(releaseCalls).toBe(1);
  expect(titleCalls).toBe(0);
  expect(activeLease).toBeNull();
});

test("closes an interrupted approval with a durable tool error", async () => {
  history = [pendingApprovalMessage()];
  streamMode = "error";

  const response = await POST(chatRequest(approvedMessage()));
  expect(response.status).toBe(200);
  await drain(response);

  expect(history[0]?.parts).toContainEqual(
    expect.objectContaining({
      state: "output-error",
      toolCallId: "call-write",
    })
  );
  expect(activeLease).toBeNull();
  expect(reserveCalls).toBe(1);
  expect(releaseCalls).toBe(1);
  expect(titleCalls).toBe(0);

  streamMode = "success";
  const followUp = await POST(
    chatRequest(userMessage("user-after-approval-error", "try a safer path"))
  );
  expect(followUp.status).toBe(200);
  await drain(followUp);
  expect(modelCalls).toBe(2);
  expect(reserveCalls).toBe(2);
  expect(releaseCalls).toBe(1);
});

test("rejects the reserved stream lease message id", async () => {
  const response = await POST(
    chatRequest(
      userMessage(
        `__chat_stream_lease__:${CHAT_ID}`,
        "overwrite the stream lease"
      )
    )
  );

  expect(response.status).toBe(400);
  expect(leaseAcquireCalls).toBe(0);
  expect(modelCalls).toBe(0);
});

test("discards a late response after its lease is stolen", async () => {
  const user = userMessage("user-stale-owner", "inspect the cluster");
  const response = await POST(chatRequest(user));
  expect(response.status).toBe(200);
  expect(activeLease).not.toBeNull();
  activeLease = {
    chatId: CHAT_ID,
    messageId: `lease-${CHAT_ID}`,
    parts: [],
    token: "replacement-owner",
  };

  await drain(response);

  expect(history).toEqual([user]);
  expect(reserveCalls).toBe(1);
  expect(releaseCalls).toBe(1);
  expect(titleCalls).toBe(0);
  expect(activeLease?.token).toBe("replacement-owner");
  expect(leaseReleaseCalls).toBe(0);
});

test("keeps partial assistant text but does not bill an errored stream", async () => {
  streamMode = "partial-error";

  const response = await POST(
    chatRequest(userMessage("user-partial", "inspect the cluster"))
  );
  expect(response.status).toBe(200);
  await drain(response);

  expect(history).toHaveLength(2);
  expect(history[1]?.role).toBe("assistant");
  expect(history[1]?.parts).toContainEqual(
    expect.objectContaining({ text: "Recovered response", type: "text" })
  );
  expect(reserveCalls).toBe(1);
  expect(releaseCalls).toBe(1);
  expect(titleCalls).toBe(0);
});

test("drops partial tool input when an errored stream has durable text", async () => {
  streamMode = "partial-tool-error";

  const response = await POST(
    chatRequest(userMessage("user-partial-tool", "inspect the cluster"))
  );
  expect(response.status).toBe(200);
  await drain(response);

  expect(history).toHaveLength(2);
  expect(history[1]?.parts).toContainEqual(
    expect.objectContaining({ text: "Recovered response", type: "text" })
  );
  expect(
    history[1]?.parts.some(
      (part) => "state" in part && part.state === "input-streaming"
    )
  ).toBe(false);
  expect(reserveCalls).toBe(1);
  expect(releaseCalls).toBe(1);
  expect(titleCalls).toBe(0);
});

test("refuses a confirmed-blocked trial request with 402 and the full header set", async () => {
  freeTierSnapshot = { limit: 5, remaining: 0, used: 5 };
  trialJudgment = "trial";

  const response = await POST(
    chatRequest(userMessage("user-blocked", "one more message"))
  );

  expect(response.status).toBe(402);
  expect(await response.json()).toEqual({
    code: "free_chat_turns_exhausted",
    error:
      "Free trial messages are used up. Upgrade your plan to keep chatting with the assistant.",
  });
  expect(response.headers.get("X-Chat-Billing")).toBe("blocked");
  expect(response.headers.get("X-Chat-Free-Remaining")).toBe("0");
  expect(response.headers.get("X-Chat-Free-Limit")).toBe("5");
  // Refused before any conversation state mutates.
  expect(history).toEqual([]);
  expect(appendCalls).toHaveLength(0);
  expect(leaseAcquireCalls).toBe(0);
  expect(modelCalls).toBe(0);
  expect(reserveCalls).toBe(0);
});

test("judges the trial per turn with the verified workspace identity", async () => {
  const response = await POST(
    chatRequest(userMessage("user-judged", "inspect the cluster"))
  );
  expect(response.status).toBe(200);
  await drain(response);

  expect(judgmentCalls).toEqual([
    {
      userId: null,
      userUid: `${WORKSPACE_ACTOR}-uid`,
      workspace: NAMESPACE,
    },
  ]);
});

test("a failed judgment with turns remaining serves the turn free (fail-open)", async () => {
  trialJudgment = "unknown";

  const response = await POST(
    chatRequest(userMessage("user-fail-open", "inspect the cluster"))
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("X-Chat-Billing")).toBe("free");
  expect(response.headers.get("X-Chat-Free-Remaining")).toBe("4");
  await drain(response);

  expect(reserveCalls).toBe(1);
  expect(releaseCalls).toBe(0);
});

test("a failed judgment with the allowance exhausted degrades to user, never 402", async () => {
  freeTierSnapshot = { limit: 5, remaining: 0, used: 5 };
  trialJudgment = "unknown";

  const response = await POST(
    chatRequest(userMessage("user-degraded", "inspect the cluster"))
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("X-Chat-Billing")).toBe("user");
  expect(response.headers.get("X-Chat-Free-Remaining")).toBe("0");
  await drain(response);

  expect(reserveCalls).toBe(0);
});

test("a non-trial workspace bills user from its first message, allowance untouched", async () => {
  trialJudgment = "not-trial";

  const response = await POST(
    chatRequest(userMessage("user-paid", "inspect the cluster"))
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("X-Chat-Billing")).toBe("user");
  expect(response.headers.get("X-Chat-Free-Remaining")).toBe("5");
  await drain(response);

  expect(reserveCalls).toBe(0);
});

test("the turn spending the last free message already reports blocked", async () => {
  freeTierSnapshot = { limit: 5, remaining: 1, used: 4 };
  trialJudgment = "trial";

  const response = await POST(
    chatRequest(userMessage("user-last-free", "inspect the cluster"))
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("X-Chat-Billing")).toBe("blocked");
  expect(response.headers.get("X-Chat-Free-Remaining")).toBe("0");
  expect(response.headers.get("X-Chat-Free-Limit")).toBe("5");
  await drain(response);

  expect(reserveCalls).toBe(1);
  expect(releaseCalls).toBe(0);
});

test("FREE_CHAT_TURNS=0 keeps silent user billing and never judges the trial", async () => {
  freeTierSnapshot = { limit: 0, remaining: 0, used: 0 };

  const response = await POST(
    chatRequest(userMessage("user-disabled", "inspect the cluster"))
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("X-Chat-Billing")).toBe("user");
  await drain(response);

  expect(judgmentCalls).toEqual([]);
  expect(reserveCalls).toBe(0);
});

test("a lost reservation race on a confirmed trial refuses with 402 before the model", async () => {
  freeTierSnapshot = { limit: 5, remaining: 1, used: 4 };
  trialJudgment = "trial";
  denyReservation = () => {
    // The concurrent winner spent the last turn between snapshot and reserve.
    freeTierSnapshot = { limit: 5, remaining: 0, used: 5 };
  };

  const response = await POST(
    chatRequest(userMessage("user-race-loser", "one more message"))
  );

  expect(response.status).toBe(402);
  expect(await response.json()).toEqual({
    code: "free_chat_turns_exhausted",
    error:
      "Free trial messages are used up. Upgrade your plan to keep chatting with the assistant.",
  });
  expect(response.headers.get("X-Chat-Billing")).toBe("blocked");
  expect(response.headers.get("X-Chat-Free-Remaining")).toBe("0");
  // Refused before any conversation state mutates or a model runs.
  expect(history).toEqual([]);
  expect(leaseAcquireCalls).toBe(0);
  expect(modelCalls).toBe(0);
  expect(reserveCalls).toBe(1);
  expect(releaseCalls).toBe(0);
});

test("a lost reservation race with an unknown judgment degrades to user billing", async () => {
  freeTierSnapshot = { limit: 5, remaining: 1, used: 4 };
  trialJudgment = "unknown";
  denyReservation = () => {
    freeTierSnapshot = { limit: 5, remaining: 0, used: 5 };
  };

  const response = await POST(
    chatRequest(userMessage("user-race-degraded", "inspect the cluster"))
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("X-Chat-Billing")).toBe("user");
  expect(response.headers.get("X-Chat-Free-Remaining")).toBe("0");
  await drain(response);

  expect(modelCalls).toBe(1);
  expect(reserveCalls).toBe(1);
  expect(releaseCalls).toBe(0);
});

test("a stream error on the last free turn rolls the reservation back", async () => {
  freeTierSnapshot = { limit: 5, remaining: 1, used: 4 };
  trialJudgment = "trial";
  streamMode = "error";

  const response = await POST(
    chatRequest(userMessage("user-last-free-error", "inspect the cluster"))
  );
  expect(response.status).toBe(200);
  // The optimistic post-turn header is truthful at send time: the turn is
  // already reserved when the response starts streaming…
  expect(response.headers.get("X-Chat-Billing")).toBe("blocked");
  await drain(response);

  // …and the failed stream rolls it back, so the turn stays spendable.
  expect(reserveCalls).toBe(1);
  expect(releaseCalls).toBe(1);
  expect(freeTierSnapshot).toEqual({ limit: 5, remaining: 1, used: 4 });
});

test("a PAYG workspace in Account Debt is walled with 402 before the model, headers naming the wall", async () => {
  trialJudgment = "not-trial";
  billingStanding = {
    ...billingStanding,
    accountDebt: true,
    availableBalanceMicroUnits: -6_320_000,
    paidSource: "balance",
  };

  const response = await POST(
    chatRequest(userMessage("user-walled", "deploy something"))
  );

  expect(response.status).toBe(402);
  expect(await response.json()).toEqual({
    code: "account_balance_exhausted",
    error:
      "Your account balance can't cover AI usage. Top up to keep chatting with the assistant.",
  });
  expect(response.headers.get("X-Chat-Billing")).toBe("user");
  expect(response.headers.get("X-Chat-Paid-Source")).toBe("balance");
  expect(response.headers.get("X-Chat-Wall")).toBe("balance");
  expect(standingCalls).toEqual([
    { userId: null, userUid: `${WORKSPACE_ACTOR}-uid`, workspace: NAMESPACE },
  ]);
  // Refused before any conversation state mutates.
  expect(history).toEqual([]);
  expect(leaseAcquireCalls).toBe(0);
  expect(modelCalls).toBe(0);
});

test("a subscribed workspace with its AI Credits spent is walled on credits", async () => {
  trialJudgment = "not-trial";
  billingStanding = {
    ...billingStanding,
    accountDebt: false,
    aiCredits: { totalMicroUnits: 3_000_000, usedMicroUnits: 3_000_000 },
    paidSource: "ai-credits",
  };

  const response = await POST(
    chatRequest(userMessage("user-credits", "deploy something"))
  );

  expect(response.status).toBe(402);
  expect(((await response.json()) as { code: string }).code).toBe(
    "ai_credits_exhausted"
  );
  expect(response.headers.get("X-Chat-Wall")).toBe("ai-credits");
  expect(modelCalls).toBe(0);
});

test("an open paid workspace streams with its paid source in the headers; unknown standing fails open", async () => {
  trialJudgment = "not-trial";
  billingStanding = {
    ...billingStanding,
    accountDebt: false,
    aiCredits: { totalMicroUnits: 3_000_000, usedMicroUnits: 1_200_000 },
    paidSource: "ai-credits",
  };

  const open = await POST(chatRequest(userMessage("user-open", "hi")));
  expect(open.status).toBe(200);
  expect(open.headers.get("X-Chat-Paid-Source")).toBe("ai-credits");
  expect(open.headers.get("X-Chat-Wall")).toBe("");
  await drain(open);

  billingStanding = { ...billingStanding, paidSource: null, aiCredits: null };
  const unknown = await POST(chatRequest(userMessage("user-unknown", "hi")));
  expect(unknown.status).toBe(200);
  expect(unknown.headers.get("X-Chat-Paid-Source")).toBe("");
  await drain(unknown);
});

test("a free turn never consults the paid wall — the standing read beside the trial judgment is ignored", async () => {
  // ADR-0068: the standing reads leave with the trial judgment under one
  // budget, so they happen; only a `user` posture looks at the answer.
  trialJudgment = "trial";
  billingStanding = {
    ...billingStanding,
    accountDebt: true,
    paidSource: "balance",
  };

  const response = await POST(chatRequest(userMessage("user-free", "hi")));
  expect(response.status).toBe(200);
  expect(response.headers.get("X-Chat-Billing")).toBe("free");
  expect(response.headers.get("X-Chat-Wall")).toBe("");
  expect(response.headers.get("X-Chat-Paid-Source")).toBe("");
  expect(standingCalls).toHaveLength(1);
  await drain(response);
});

test("aiproxy refusing the token request for balance reads as a billing refusal, not a connection outage", async () => {
  trialJudgment = "not-trial";
  billingStanding = {
    ...billingStanding,
    accountDebt: false,
    paidSource: "balance",
  };
  connectionRefusal = {
    message:
      '{"type":"group_balance_not_enough","message":"group `ns` balance not enough"}',
    status: 403,
  };

  const response = await POST(
    chatRequest(userMessage("user-refused", "deploy something"))
  );

  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({
    code: "ai_proxy_billing_refused",
    detail: { paidSource: "balance" },
    error: "The AI proxy refused this turn for billing reasons.",
  });
});
