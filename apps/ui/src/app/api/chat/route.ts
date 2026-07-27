import { isDeepStrictEqual } from "node:util";
import {
  consumeStream,
  convertToModelMessages,
  generateId,
  isToolUIPart,
  stepCountIs,
  streamText,
  type UIMessage,
  type UIMessageStreamOnFinishCallback,
} from "ai";
import {
  type ChatBillingMode,
  resolveChatOpenAiConnection,
} from "@/features/chat/ai-proxy/resolve-chat-open-ai-connection";
import {
  consumeFreeTurnIfAvailable,
  getFreeTierSnapshot,
  isSystemOpenAiConfigured,
} from "@/features/chat/persistence/free-tier";
import {
  freeTierPosture,
  freeTierPostureAfterTurn,
} from "@/features/chat/persistence/free-tier-core";
import {
  acquireChatStreamLease,
  type ChatStreamLease,
  commitChatMessagesIfLeaseOwned,
  ensureAssistantThreadForOwner,
  isReservedChatMessageId,
  loadMessagesForOwner,
  maybeAutoTitleThread,
  persistAssistantResponseIfLeaseOwned,
  releaseOwnedChatStreamLease,
  renewOwnedChatStreamLease,
} from "@/features/chat/persistence/service";
import {
  type AssistantConversationOwner,
  buildAssistantContinuationFromPending,
  buildRecoveredAssistantMessageForInterruptedTools,
  type ChatStreamRequest,
  chatStreamRequestSchema,
  findPendingAssistantMessageForContinuation,
  isAssistantContinuationMessage,
  isPersistedUIMessage,
  normalizeAssistantNamespace,
} from "@/features/chat/persistence/types";
import { attachToolDurationMetrics } from "@/features/chat/runtime/attach-tool-duration-metrics";
import {
  type ChatStreamLeaseHeartbeat,
  startChatStreamLeaseHeartbeat,
} from "@/features/chat/runtime/chat-stream-lease-heartbeat";
import { jsonError } from "@/features/chat/runtime/errors";
import { createInjectToolDurationStreamTransform } from "@/features/chat/runtime/inject-tool-duration-stream";
import {
  CHAT_MAX_STEPS,
  chatLanguageModel,
  threadTitleLanguageModel,
} from "@/features/chat/runtime/model";
import { withSelectedResourceContext } from "@/features/chat/runtime/selected-resource-context";
import { buildChatToolset } from "@/features/chat/runtime/tools";
import { decodeKubeconfig } from "@/lib/kubeconfig";
import { authorizeWorkspaceActor } from "@/lib/request-kubeconfig-auth";

export const maxDuration = 120;

const CHAT_STREAM_TIMEOUT_MS = 110_000;
const CHAT_TITLE_TIMEOUT_MS = 5000;

const INTERRUPTED_TOOL_ERROR =
  "Tool execution was interrupted before a result was available.";

function persistableAssistantResponse(
  responseMessage: UIMessage,
  interrupted: boolean
): UIMessage {
  const parts: UIMessage["parts"] = [];
  for (const part of responseMessage.parts) {
    if (!isToolUIPart(part)) {
      parts.push(part);
      continue;
    }
    if (part.state === "input-streaming") {
      continue;
    }
    if (interrupted && part.state === "input-available") {
      parts.push({
        ...part,
        errorText: INTERRUPTED_TOOL_ERROR,
        state: "output-error" as const,
      });
      continue;
    }
    if (interrupted && part.state === "approval-responded") {
      parts.push(
        part.approval.approved
          ? {
              ...part,
              approval: { ...part.approval, approved: true as const },
              errorText: INTERRUPTED_TOOL_ERROR,
              state: "output-error" as const,
            }
          : {
              ...part,
              approval: { ...part.approval, approved: false as const },
              state: "output-denied" as const,
            }
      );
      continue;
    }
    parts.push(part);
  }
  return { ...responseMessage, parts };
}

function durableAssistantParts(message: UIMessage): UIMessage["parts"] {
  return message.parts.filter((part) => {
    if (part.type === "step-start") {
      return false;
    }
    if (
      (part.type === "text" || part.type === "reasoning") &&
      part.text.trim() === ""
    ) {
      return false;
    }
    return !(isToolUIPart(part) && part.state === "input-streaming");
  });
}

function hasDurableAssistantProgress(
  history: UIMessage[],
  responseMessage: UIMessage
): boolean {
  const responseParts = durableAssistantParts(responseMessage);
  const previous = history.at(-1);
  if (previous?.role === "assistant" && previous.id === responseMessage.id) {
    return !isDeepStrictEqual(durableAssistantParts(previous), responseParts);
  }
  return responseParts.length > 0;
}

function assertCompleteToolHistory(history: UIMessage[]): void {
  for (const message of history) {
    for (const part of message.parts) {
      if (
        !isToolUIPart(part) ||
        part.providerExecuted === true ||
        part.state === "approval-responded" ||
        part.state === "output-available" ||
        part.state === "output-denied" ||
        part.state === "output-error"
      ) {
        continue;
      }
      throw new Error(
        `Incomplete tool result in assistant history: ${part.toolCallId}`
      );
    }
  }
}

function incompleteToolHistoryResponse(
  history: UIMessage[]
): Response | undefined {
  for (const message of history) {
    for (const part of message.parts) {
      if (
        !isToolUIPart(part) ||
        part.providerExecuted === true ||
        part.state === "approval-responded" ||
        part.state === "output-available" ||
        part.state === "output-denied" ||
        part.state === "output-error"
      ) {
        continue;
      }
      if (part.state === "approval-requested") {
        return jsonError(
          "A tool approval is pending. Approve or deny it before sending a new message.",
          409
        );
      }
      return jsonError(
        "This conversation contains an incomplete tool call that cannot be recovered. Start a new chat to continue.",
        409
      );
    }
  }
  return undefined;
}

interface PendingAssistantReplacement {
  expected: UIMessage;
  replacement: UIMessage;
}

type PreparedIncomingChatMessage =
  | {
      message: UIMessage;
      recoveries: PendingAssistantReplacement[];
      type: "user";
    }
  | (PendingAssistantReplacement & {
      recoveries: PendingAssistantReplacement[];
      type: "assistant";
    });

function interruptedToolRecoveries(
  history: UIMessage[],
  excludedMessageId?: string
): PendingAssistantReplacement[] {
  return history.flatMap((storedMessage) => {
    if (storedMessage.id === excludedMessageId) {
      return [];
    }
    const replacement =
      buildRecoveredAssistantMessageForInterruptedTools(storedMessage);
    return replacement == null
      ? []
      : [{ expected: storedMessage, replacement }];
  });
}

function projectAssistantReplacements(
  history: UIMessage[],
  replacements: PendingAssistantReplacement[]
): UIMessage[] {
  const byMessageId = new Map(
    replacements.map((replacement) => [
      replacement.expected.id,
      replacement.replacement,
    ])
  );
  return history.map((message) => byMessageId.get(message.id) ?? message);
}

function prepareIncomingChatMessage(
  history: UIMessage[],
  message: unknown
):
  | { prepared: PreparedIncomingChatMessage; response?: never }
  | { prepared?: never; response: Response } {
  if (!isPersistedUIMessage(message)) {
    return { response: jsonError("Malformed UI message payload", 400) };
  }
  if (isReservedChatMessageId(message.id)) {
    return { response: jsonError("Reserved chat message id", 400) };
  }

  if (message.role === "user") {
    const recoveries = interruptedToolRecoveries(history);
    const conflict = incompleteToolHistoryResponse(
      projectAssistantReplacements(history, recoveries)
    );
    if (conflict != null) {
      return { response: conflict };
    }
    return { prepared: { message, recoveries, type: "user" } };
  }

  if (!isAssistantContinuationMessage(message)) {
    return {
      response: jsonError(
        "Only user messages or valid assistant continuations accepted.",
        400
      ),
    };
  }

  const pending = findPendingAssistantMessageForContinuation(history, message);
  if (pending == null) {
    return {
      response: jsonError(
        "Stale assistant continuation for this thread. Reload and retry.",
        409
      ),
    };
  }

  const candidate =
    pending.id === message.id ? message : { ...message, id: pending.id };
  const replacement = buildAssistantContinuationFromPending(pending, candidate);
  if (replacement == null) {
    if (isDeepStrictEqual(pending.parts, candidate.parts)) {
      return {
        response: jsonError(
          "Stale assistant continuation for this thread. Reload and retry.",
          409
        ),
      };
    }
    return {
      response: jsonError(
        "Invalid assistant continuation for this thread.",
        400
      ),
    };
  }
  const recoveries = interruptedToolRecoveries(history, pending.id);
  const projected = projectAssistantReplacements(history, [
    ...recoveries,
    { expected: pending, replacement },
  ]);
  const conflict = incompleteToolHistoryResponse(projected);
  if (conflict != null) {
    return { response: conflict };
  }
  return {
    prepared: {
      expected: pending,
      recoveries,
      replacement,
      type: "assistant",
    },
  };
}

async function commitIncomingChatMessage(
  chatId: string,
  lease: ChatStreamLease,
  prepared: PreparedIncomingChatMessage
): Promise<
  { lease: ChatStreamLease; response?: never } | { response: Response }
> {
  const replacements =
    prepared.type === "user"
      ? prepared.recoveries
      : [...prepared.recoveries, prepared];
  const renewedLease = await commitChatMessagesIfLeaseOwned({
    lease,
    replacements: replacements.map(({ expected, replacement }) => ({
      expectedParts: expected.parts,
      messageId: expected.id,
      replacementParts: replacement.parts,
    })),
    upsertMessage: prepared.type === "user" ? prepared.message : undefined,
  });
  if (renewedLease == null) {
    return {
      response: jsonError(
        prepared.type === "assistant"
          ? "Stale assistant continuation for this thread. Reload and retry."
          : "Assistant thread changed concurrently. Reload and retry.",
        409
      ),
    };
  }

  for (const { expected } of prepared.recoveries) {
    console.warn("[api/chat] recovered interrupted tool result:", {
      chatId,
      messageId: expected.id,
    });
  }
  return { lease: renewedLease };
}

function projectIncomingChatMessage(
  history: UIMessage[],
  prepared: PreparedIncomingChatMessage
): UIMessage[] {
  const replacements =
    prepared.type === "assistant"
      ? [...prepared.recoveries, prepared]
      : prepared.recoveries;
  const projected = projectAssistantReplacements(history, replacements);
  if (prepared.type === "assistant") {
    return projected;
  }

  const existingIndex = projected.findIndex(
    (message) => message.id === prepared.message.id
  );
  if (existingIndex === -1) {
    projected.push(prepared.message);
  } else {
    projected[existingIndex] = prepared.message;
  }
  return projected;
}

async function releaseLeaseQuietly(lease: ChatStreamLease): Promise<void> {
  try {
    await releaseOwnedChatStreamLease(lease);
  } catch (error) {
    console.error("[api/chat] release stream lease:", error);
  }
}

async function acquireLeaseForHistory(
  chatId: string,
  owner: AssistantConversationOwner,
  expectedHistory: UIMessage[]
): Promise<
  { lease: ChatStreamLease; response?: never } | { response: Response }
> {
  const lease = await acquireChatStreamLease(chatId, owner);
  if (lease == null) {
    return {
      response: jsonError(
        "Another assistant turn is already running. Reload and retry.",
        409
      ),
    };
  }

  const claimedHistory = await loadMessagesForOwner(chatId, owner);
  if (isDeepStrictEqual(claimedHistory, expectedHistory)) {
    return { lease };
  }
  await releaseLeaseQuietly(lease);
  return {
    response: jsonError(
      "Assistant thread changed concurrently. Reload and retry.",
      409
    ),
  };
}

function createChatStreamFinishHandler(input: {
  billing: ChatBillingMode;
  chatId: string;
  history: UIMessage[];
  heartbeat: ChatStreamLeaseHeartbeat<ChatStreamLease>;
  owner: AssistantConversationOwner;
  projectName?: string;
  titleModel: Parameters<typeof maybeAutoTitleThread>[0]["languageModel"];
  toolDurationMsByCallId: Map<string, number>;
}): UIMessageStreamOnFinishCallback<UIMessage> {
  return async ({ finishReason, isAborted, responseMessage }) => {
    const lease = await input.heartbeat.stop();
    if (lease == null) {
      return;
    }
    let leaseReleased = false;
    try {
      const interrupted =
        isAborted || finishReason == null || finishReason === "error";
      const persistable = persistableAssistantResponse(
        responseMessage,
        interrupted
      );
      if (!hasDurableAssistantProgress(input.history, persistable)) {
        return;
      }

      const persisted = await persistAssistantResponseIfLeaseOwned({
        lease,
        message: attachToolDurationMetrics(
          persistable,
          input.toolDurationMsByCallId
        ),
      });
      if (!persisted) {
        console.warn(
          "[api/chat] discarded response after stream lease expired:",
          input.chatId
        );
        return;
      }
      if (interrupted) {
        return;
      }
      if (input.billing === "free") {
        const consumed = await consumeFreeTurnIfAvailable(
          input.owner.namespace
        );
        if (!consumed) {
          console.warn(
            "[api/chat] free turn not recorded (limit reached concurrently):",
            input.owner.namespace
          );
        }
      }
      await releaseLeaseQuietly(lease);
      leaseReleased = true;
      await maybeAutoTitleThread({
        abortSignal: AbortSignal.timeout(CHAT_TITLE_TIMEOUT_MS),
        chatId: input.chatId,
        languageModel: input.titleModel,
        owner: input.owner,
        projectName: input.projectName,
      });
    } catch (error) {
      console.error("[api/chat] persist assistant turn:", error);
    } finally {
      if (!leaseReleased) {
        await releaseLeaseQuietly(lease);
      }
    }
  };
}

async function cleanUpFailedChatPipeline(input: {
  chatId: string;
  lease: ChatStreamLease | null;
  rollbackAssistant: PendingAssistantReplacement | null;
}): Promise<void> {
  let leaseToRelease = input.lease;
  if (input.lease != null && input.rollbackAssistant != null) {
    try {
      const rolledBackLease = await commitChatMessagesIfLeaseOwned({
        lease: input.lease,
        replacements: [
          {
            expectedParts: input.rollbackAssistant.replacement.parts,
            messageId: input.rollbackAssistant.expected.id,
            replacementParts: input.rollbackAssistant.expected.parts,
          },
        ],
      });
      if (rolledBackLease == null) {
        console.error(
          "[api/chat] could not roll back assistant continuation after setup failure"
        );
      } else {
        leaseToRelease = rolledBackLease;
      }
    } catch (error) {
      console.error("[api/chat] roll back assistant continuation:", error);
    }
  }
  if (leaseToRelease != null) {
    await releaseLeaseQuietly(leaseToRelease);
  }
}

async function runChatPipeline(input: {
  kubeconfig: string;
  owner: AssistantConversationOwner;
  request: ChatStreamRequest;
  requestAbortSignal: AbortSignal;
}): Promise<Response> {
  const { assistantContext, chatId, encodedKubeconfig, message } =
    input.request;
  const { kubeconfig, owner, requestAbortSignal } = input;
  let ownedLease: ChatStreamLease | null = null;
  let leaseHeartbeat: ChatStreamLeaseHeartbeat<ChatStreamLease> | null = null;
  let rollbackAssistant: PendingAssistantReplacement | null = null;
  try {
    const threadReady = await ensureAssistantThreadForOwner(chatId, owner);
    if (!threadReady) {
      return jsonError("Assistant conversation not found.", 404);
    }

    const storedHistory = await loadMessagesForOwner(chatId, owner);
    if (storedHistory == null) {
      return jsonError("Assistant conversation not found.", 404);
    }
    const incoming = prepareIncomingChatMessage(storedHistory, message);
    if (incoming.response != null) {
      return incoming.response;
    }

    const freeTier = await getFreeTierSnapshot(owner.namespace);
    const systemModelConfigured = isSystemOpenAiConfigured();
    const billing: ChatBillingMode = freeTierPosture(
      freeTier,
      systemModelConfigured
    ).billing;

    // Complete every fallible runtime preflight before committing an approval
    // or browser-tool continuation. A failed preflight must remain retryable.
    const { tools, systemPrompt } = await buildChatToolset({
      assistantContext,
      kubeconfig,
      kubernetesNamespace: owner.namespace,
      workspaceActor: owner.workspaceActor,
    });

    const openAi = await resolveChatOpenAiConnection({
      encodedKubeconfig,
      kubeconfigText: kubeconfig,
      billing,
    });
    if (!openAi.ok) {
      return jsonError(openAi.message, openAi.status);
    }
    const model = chatLanguageModel(openAi.connection);
    const titleModel = threadTitleLanguageModel(openAi.connection);
    const history = projectIncomingChatMessage(
      storedHistory,
      incoming.prepared
    );
    assertCompleteToolHistory(history);
    const modelMessages = await convertToModelMessages(
      withSelectedResourceContext(history),
      { tools }
    );

    const claimed = await acquireLeaseForHistory(chatId, owner, storedHistory);
    if (claimed.response != null) {
      return claimed.response;
    }
    ownedLease = claimed.lease;

    const committed = await commitIncomingChatMessage(
      chatId,
      ownedLease,
      incoming.prepared
    );
    if (committed.response != null) {
      await releaseLeaseQuietly(ownedLease);
      ownedLease = null;
      return committed.response;
    }
    ownedLease = committed.lease;
    if (incoming.prepared.type === "assistant") {
      rollbackAssistant = incoming.prepared;
    }

    const toolDurationMsByCallId = new Map<string, number>();
    const leaseAbortController = new AbortController();
    leaseHeartbeat = startChatStreamLeaseHeartbeat({
      abort: (reason) => leaseAbortController.abort(reason),
      initialLease: ownedLease,
      renew: renewOwnedChatStreamLease,
    });
    const streamAbortSignal = AbortSignal.any([
      requestAbortSignal,
      AbortSignal.timeout(CHAT_STREAM_TIMEOUT_MS),
      leaseAbortController.signal,
    ]);

    const result = streamText({
      abortSignal: streamAbortSignal,
      model,
      providerOptions: {
        openai: {
          reasoningEffort: "high",
        },
      },
      system: systemPrompt,
      messages: modelMessages,
      tools,
      stopWhen: stepCountIs(CHAT_MAX_STEPS),
      experimental_transform: createInjectToolDurationStreamTransform(
        toolDurationMsByCallId
      ),
      experimental_onToolCallFinish: (event) => {
        toolDurationMsByCallId.set(event.toolCall.toolCallId, event.durationMs);
      },
    });

    // Headers carry the POST-turn posture: the turn spending the last free
    // turn already reports `user`, so the pane retires the counter at
    // exhaustion instead of pinning "Free 0/n" until the next message.
    const clientFreeTier = freeTierPostureAfterTurn(
      freeTier,
      systemModelConfigured
    );
    const responseHeaders: Record<string, string> = {
      "X-Chat-Billing": clientFreeTier.billing,
      "X-Chat-Free-Remaining": String(clientFreeTier.remaining),
      "X-Chat-Free-Limit": String(clientFreeTier.limit),
    };

    const streamHeartbeat = leaseHeartbeat;
    const response = result.toUIMessageStreamResponse({
      consumeSseStream: consumeStream,
      originalMessages: history,
      generateMessageId: generateId,
      headers: responseHeaders,
      onFinish: createChatStreamFinishHandler({
        billing,
        chatId,
        history,
        heartbeat: streamHeartbeat,
        owner,
        projectName: assistantContext?.projectName,
        titleModel,
        toolDurationMsByCallId,
      }),
    });
    ownedLease = null;
    leaseHeartbeat = null;
    rollbackAssistant = null;
    return response;
  } catch (error) {
    if (leaseHeartbeat != null) {
      ownedLease = await leaseHeartbeat.stop();
      leaseHeartbeat = null;
    }
    await cleanUpFailedChatPipeline({
      chatId,
      lease: ownedLease,
      rollbackAssistant,
    });
    console.error("[api/chat] pipeline:", error);
    return jsonError(
      "Could not handle chat request (DATABASE_URL, schema migrations, or upstream).",
      503
    );
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (body == null) {
    return jsonError("Invalid JSON body", 400);
  }

  const parsed = chatStreamRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("Invalid chat request", 400, parsed.error.flatten());
  }

  const authorization = await authorizeWorkspaceActor({
    encodedKubeconfig: parsed.data.encodedKubeconfig,
    expectedNamespace: parsed.data.namespace.trim() || undefined,
    normalizeNamespace: normalizeAssistantNamespace,
  });
  if (!authorization.ok) {
    return jsonError(authorization.message, authorization.status);
  }
  const owner: AssistantConversationOwner = {
    namespace: authorization.namespace,
    workspaceActor: authorization.workspaceActor,
  };
  const kubeconfig = decodeKubeconfig(parsed.data.encodedKubeconfig);
  if (kubeconfig == null) {
    return jsonError("Authentication is required.", 401);
  }
  return runChatPipeline({
    kubeconfig,
    owner,
    request: parsed.data,
    requestAbortSignal: req.signal,
  });
}
