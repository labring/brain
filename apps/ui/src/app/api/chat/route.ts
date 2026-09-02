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
import { workspaceResourceQuotaSnapshotSchema } from "@/features/billing/workspace-resource-quota";
import {
  type ChatBillingMode,
  resolveChatOpenAiConnection,
} from "@/features/chat/ai-proxy/resolve-chat-open-ai-connection";
import {
  type ChatBillingActor,
  judgeChatBilling,
  withPaidChatWall,
} from "@/features/chat/persistence/chat-billing-judgment";
import {
  getFreeTierSnapshot,
  releaseReservedFreeTurn,
  reserveFreeTurnIfAvailable,
} from "@/features/chat/persistence/free-tier";
import {
  freeTierPosture,
  freeTierPostureAfterTurn,
} from "@/features/chat/persistence/free-tier-core";
import {
  acquireChatStreamLease,
  adoptLegacyAssistantConversationsForActor,
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
import type { FreeTierState } from "@/features/chat/persistence/types";
import {
  type AssistantConversationScope,
  buildAssistantContinuationFromPending,
  buildRecoveredAssistantMessageForInterruptedTools,
  type ChatStreamRequest,
  chatStreamRequestSchema,
  findPendingAssistantMessageForContinuation,
  isAssistantContinuationMessage,
  isPersistedUIMessage,
  normalizeAssistantNamespace,
  type VerifiedAssistantConversationActor,
} from "@/features/chat/persistence/types";
import {
  chatStreamErrorText,
  isAiProxyBillingRefusal,
} from "@/features/chat/runtime/ai-proxy-billing-refusal";
import { attachToolDurationMetrics } from "@/features/chat/runtime/attach-tool-duration-metrics";
import {
  type ChatStreamLeaseHeartbeat,
  startChatStreamLeaseHeartbeat,
} from "@/features/chat/runtime/chat-stream-lease-heartbeat";
import {
  type ChatApiErrorBody,
  jsonError,
} from "@/features/chat/runtime/errors";
import { createInjectToolDurationStreamTransform } from "@/features/chat/runtime/inject-tool-duration-stream";
import {
  CHAT_MAX_STEPS,
  chatLanguageModel,
  threadTitleLanguageModel,
} from "@/features/chat/runtime/model";
import { withSelectedResourceContext } from "@/features/chat/runtime/selected-resource-context";
import { buildChatToolset } from "@/features/chat/runtime/tools";
import { withWorkspaceResourceContext } from "@/features/chat/runtime/workspace-resource-context";
import { observeWorkspaceQuotaQuietly } from "@/features/notifications/producers";
import { appTokenFromRequest } from "@/lib/app-token";
import { IdentityBindingSupersededError } from "@/lib/identity-fingerprint-core";
import { decodeKubeconfig } from "@/lib/kubeconfig";
import { authorizeWorkspaceActor } from "@/lib/request-kubeconfig-auth";
import { verifiedPersonalResourceActor } from "@/lib/verified-personal-actor";

const CHAT_TITLE_TIMEOUT_MS = 5000;

const INTERRUPTED_TOOL_ERROR =
  "Tool execution was interrupted before a result was available.";

/** The `X-Chat-*` set every chat response carries — paid-wall refusals included. */
function chatBillingHeaders(state: FreeTierState): Record<string, string> {
  return {
    "X-Chat-Billing": state.billing,
    "X-Chat-Free-Remaining": String(state.remaining),
    "X-Chat-Free-Limit": String(state.limit),
    "X-Chat-Paid-Source": state.paidSource ?? "",
    "X-Chat-Wall": state.wall ?? "",
  };
}

/** The paid wall's refusal (design spec row E3; allowance causes ADR-0073). */
function paidWallResponse(state: FreeTierState): Response {
  let body: ChatApiErrorBody;
  if (state.wall === "allowance-trial" || state.wall === "allowance-plan") {
    body = {
      code: "ai_allowance_missing",
      error:
        "This workspace's plan doesn't include AI usage. Upgrade the plan to keep chatting with the assistant.",
    };
  } else if (state.wall === "ai-credits") {
    body = {
      code: "ai_credits_exhausted",
      error:
        "This workspace's AI Credits are used up. Upgrade the plan to keep chatting with the assistant.",
    };
  } else {
    body = {
      code: "account_balance_exhausted",
      error:
        "Your account balance can't cover AI usage. Top up in Sealos Desktop to keep chatting with the assistant.",
    };
  }
  return Response.json(body, {
    headers: chatBillingHeaders(state),
    status: 402,
  });
}

async function releaseReservedFreeTurnQuietly(
  namespace: string
): Promise<void> {
  try {
    await releaseReservedFreeTurn(namespace);
  } catch (error) {
    console.error("[api/chat] release reserved free turn:", error);
  }
}

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
          "tool_approval_pending",
          "A tool approval is pending. Approve or deny it before sending a new message.",
          409
        );
      }
      return jsonError(
        "incomplete_tool_history",
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
    return {
      response: jsonError(
        "invalid_request",
        "Malformed UI message payload",
        400
      ),
    };
  }
  if (isReservedChatMessageId(message.id)) {
    return {
      response: jsonError("invalid_request", "Reserved chat message id", 400),
    };
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
        "invalid_request",
        "Only user messages or valid assistant continuations accepted.",
        400
      ),
    };
  }

  const pending = findPendingAssistantMessageForContinuation(history, message);
  if (pending == null) {
    return {
      response: jsonError(
        "stale_assistant_continuation",
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
          "stale_assistant_continuation",
          "Stale assistant continuation for this thread. Reload and retry.",
          409
        ),
      };
    }
    return {
      response: jsonError(
        "invalid_request",
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
      response:
        prepared.type === "assistant"
          ? jsonError(
              "stale_assistant_continuation",
              "Stale assistant continuation for this thread. Reload and retry.",
              409
            )
          : jsonError(
              "assistant_thread_conflict",
              "Assistant thread changed concurrently. Reload and retry.",
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
  scope: AssistantConversationScope,
  expectedHistory: UIMessage[]
): Promise<
  { lease: ChatStreamLease; response?: never } | { response: Response }
> {
  const lease = await acquireChatStreamLease(chatId, scope);
  if (lease == null) {
    return {
      response: jsonError(
        "assistant_turn_in_progress",
        "Another assistant turn is already running. Reload and retry.",
        409
      ),
    };
  }

  const claimedHistory = await loadMessagesForOwner(chatId, scope);
  if (isDeepStrictEqual(claimedHistory, expectedHistory)) {
    return { lease };
  }
  await releaseLeaseQuietly(lease);
  return {
    response: jsonError(
      "assistant_thread_conflict",
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
  scope: AssistantConversationScope;
  projectName?: string;
  titleModel: Parameters<typeof maybeAutoTitleThread>[0]["languageModel"];
  toolDurationMsByCallId: Map<string, number>;
}): UIMessageStreamOnFinishCallback<UIMessage> {
  return async ({ finishReason, isAborted, responseMessage }) => {
    const lease = await input.heartbeat.stop();
    let freeTurnSpent = false;
    let leaseReleased = false;
    try {
      if (lease == null) {
        return;
      }
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
      freeTurnSpent = true;
      await releaseLeaseQuietly(lease);
      leaseReleased = true;
      await maybeAutoTitleThread({
        abortSignal: AbortSignal.timeout(CHAT_TITLE_TIMEOUT_MS),
        chatId: input.chatId,
        languageModel: input.titleModel,
        scope: input.scope,
        projectName: input.projectName,
      });
    } catch (error) {
      console.error("[api/chat] persist assistant turn:", error);
    } finally {
      // A `free` turn arrives here holding its pre-stream reservation; only
      // a persisted, uninterrupted turn keeps it — an empty or errored
      // stream, an abort, or a lost lease rolls it back.
      if (input.billing === "free" && !freeTurnSpent) {
        await releaseReservedFreeTurnQuietly(input.scope.namespace);
      }
      if (lease != null && !leaseReleased) {
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

/**
 * Chat Billing Posture for this turn (ADR-0069), with the free turn already
 * reserved on the counter when it returns `billing: "free"`. Reserving before
 * any model execution makes concurrent turns race on the counter itself, so
 * the allowance can never be overspent; the caller owns rolling the
 * reservation back on every unsuccessful path. The trial judgment and the
 * paid wall's standing reads run in parallel under one budget (ADR-0068).
 */
async function settleTurnBillingPosture(actor: ChatBillingActor): Promise<
  | { response: Response; billing?: never }
  | {
      billing: ChatBillingMode;
      /** Post-turn posture for the `X-Chat-*` response headers. */
      clientFreeTier: FreeTierState;
      reserved: boolean;
      response?: never;
    }
> {
  const judgment = await judgeChatBilling(actor);
  const { snapshot: freeTier, systemModelConfigured, trial } = judgment;
  const posture = freeTierPosture(freeTier, systemModelConfigured, trial);
  if (posture.billing !== "free") {
    const walled = await withPaidChatWall(posture, judgment);
    if (walled.wall != null) {
      return { response: paidWallResponse(walled) };
    }
    return {
      billing: "user",
      clientFreeTier: walled,
      reserved: false,
    };
  }

  if (await reserveFreeTurnIfAvailable(actor.namespace)) {
    // Headers carry the POST-turn posture: the turn spending the last free
    // turn already reports `user`, walled the way session bootstrap would
    // wall it, so headers and bootstrap agree and the pane locks the moment
    // the allowance is spent (ADR-0073) — not one refused send later. Any
    // earlier free turn keeps its `free` posture and never awaits the
    // standing.
    return {
      billing: "free",
      clientFreeTier: await withPaidChatWall(
        freeTierPostureAfterTurn(freeTier, systemModelConfigured, trial),
        judgment
      ),
      reserved: true,
    };
  }

  // Lost the counter race to a concurrent turn: re-judge on a fresh snapshot
  // and continue as a user-billed turn, walled on the standing already read
  // for this request.
  const contested = await getFreeTierSnapshot(actor.namespace);
  const contestedPosture = freeTierPosture(
    contested,
    systemModelConfigured,
    trial
  );
  const walled = await withPaidChatWall(
    { ...contestedPosture, billing: "user" },
    judgment
  );
  if (walled.wall != null) {
    return { response: paidWallResponse(walled) };
  }
  return {
    billing: "user",
    clientFreeTier: walled,
    reserved: false,
  };
}

async function runChatPipeline(input: {
  actor: VerifiedAssistantConversationActor;
  /** Forwards the billing dev-mock scenario cookie in dev/demo builds. */
  cookieHeader: string | null;
  kubeconfig: string;
  request: ChatStreamRequest;
  requestAbortSignal: AbortSignal;
}): Promise<Response> {
  const { assistantContext, chatId, encodedKubeconfig, message } =
    input.request;
  const { actor, kubeconfig, requestAbortSignal } = input;
  const owner = actor.owner;
  const scope: AssistantConversationScope = {
    ...owner,
    projectId: assistantContext.projectId,
  };
  let ownedLease: ChatStreamLease | null = null;
  let leaseHeartbeat: ChatStreamLeaseHeartbeat<ChatStreamLease> | null = null;
  let rollbackAssistant: PendingAssistantReplacement | null = null;
  let ownedFreeTurnReservation = false;
  try {
    // The Active Free Trial is judged live on every turn (ADR-0069). Once its
    // allowance is exhausted, the same request continues through the paid
    // wall and the caller's AI Proxy.
    const settled = await settleTurnBillingPosture({
      accountUserId: actor.accountUserId ?? null,
      cookieHeader: input.cookieHeader,
      namespace: owner.namespace,
      userUid: owner.userUid,
    });
    if (settled.response != null) {
      return settled.response;
    }
    const { billing, clientFreeTier } = settled;
    ownedFreeTurnReservation = settled.reserved;

    // Adopt before the thread ensure: continuing a legacy crName-keyed
    // conversation must find the re-keyed row instead of refusing its id.
    await adoptLegacyAssistantConversationsForActor(actor);

    const threadReady = await ensureAssistantThreadForOwner(
      chatId,
      actor,
      scope.projectId
    );
    if (!threadReady) {
      return jsonError(
        "assistant_conversation_not_found",
        "Assistant conversation not found.",
        404
      );
    }

    const storedHistory = await loadMessagesForOwner(chatId, scope);
    if (storedHistory == null) {
      return jsonError(
        "assistant_conversation_not_found",
        "Assistant conversation not found.",
        404
      );
    }
    const incoming = prepareIncomingChatMessage(storedHistory, message);
    if (incoming.response != null) {
      return incoming.response;
    }

    // Complete every fallible runtime preflight before committing an approval
    // or browser-tool continuation. A failed preflight must remain retryable.
    // The toolset's deploy-task actor stays the per-region crName: chat
    // deploy tools perform only namespace-shared actions, which record the
    // kubeconfig-verified identity (AIM-154 keeps them token-free).
    const { tools, systemPrompt } = await buildChatToolset({
      assistantContext,
      billingActor: {
        cookieHeader: input.cookieHeader,
        userId: actor.accountUserId ?? null,
        userUid: owner.userUid,
      },
      chatId,
      kubeconfig,
      kubernetesNamespace: owner.namespace,
      workspaceActor: actor.legacyWorkspaceActor,
      workspaceUserUid: owner.userUid,
    });

    const openAi = await resolveChatOpenAiConnection({
      encodedKubeconfig,
      kubeconfigText: kubeconfig,
      billing,
    });
    if (!openAi.ok) {
      // aiproxy refuses an exhausted group at the token request too; the
      // pane must hear "billing", not "connection unavailable".
      if (
        isAiProxyBillingRefusal({
          bodyText: openAi.message,
          status: openAi.status,
        })
      ) {
        return jsonError(
          "ai_proxy_billing_refused",
          "The AI proxy refused this turn for billing reasons.",
          openAi.status,
          { paidSource: clientFreeTier.paidSource ?? null }
        );
      }
      return jsonError(
        "ai_connection_unavailable",
        openAi.message,
        openAi.status
      );
    }
    const model = chatLanguageModel(openAi.connection);
    const titleModel = threadTitleLanguageModel(openAi.connection);
    const history = projectIncomingChatMessage(
      storedHistory,
      incoming.prepared
    );
    assertCompleteToolHistory(history);
    const modelMessages = await convertToModelMessages(
      withWorkspaceResourceContext(
        withSelectedResourceContext(history),
        input.request.workspaceResourceQuota
      ),
      { tools }
    );

    const claimed = await acquireLeaseForHistory(chatId, scope, storedHistory);
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
    // No wall-clock ceiling: the turn ends when the client disconnects or the
    // stream lease is lost. A fixed deadline only manufactured interrupted
    // tools, since a cold Devbox plus one command already exceeds any value
    // small enough to be useful.
    const streamAbortSignal = AbortSignal.any([
      requestAbortSignal,
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

    const responseHeaders = chatBillingHeaders(clientFreeTier);

    const streamHeartbeat = leaseHeartbeat;
    const response = result.toUIMessageStreamResponse({
      consumeSseStream: consumeStream,
      originalMessages: history,
      generateMessageId: generateId,
      headers: responseHeaders,
      // A mid-stream aiproxy billing refusal reaches the pane classified;
      // every other error stays masked.
      onError: (error) =>
        chatStreamErrorText(error, clientFreeTier.paidSource ?? null),
      onFinish: createChatStreamFinishHandler({
        billing,
        chatId,
        history,
        heartbeat: streamHeartbeat,
        scope,
        projectName: assistantContext?.projectName,
        titleModel,
        toolDurationMsByCallId,
      }),
    });
    ownedLease = null;
    leaseHeartbeat = null;
    rollbackAssistant = null;
    // The finish handler owns the reservation from here: it keeps it on a
    // billable turn and rolls it back on an unsuccessful one.
    ownedFreeTurnReservation = false;
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
    if (error instanceof IdentityBindingSupersededError) {
      // The binding was superseded by an account merge mid-request; the
      // desktop re-login loop re-mints a current token (ADR-0059).
      return jsonError(
        "app_token_superseded",
        "Authentication is required.",
        401
      );
    }
    console.error("[api/chat] pipeline:", error);
    return jsonError(
      "assistant_chat_unavailable",
      "Could not handle chat request (DATABASE_URL, schema migrations, or upstream).",
      503
    );
  } finally {
    // Covers every exit between reservation and the streaming response —
    // early refusals (404/409), preflight failures, and thrown errors.
    if (ownedFreeTurnReservation) {
      await releaseReservedFreeTurnQuietly(owner.namespace);
    }
  }
}

/**
 * Lets the Conversation Dev Mock stage an aiproxy billing refusal mid-stream
 * in dev and demo builds (`NEXT_PUBLIC_DEV_TWEAKS=1` marks a demo image); a
 * production build statically drops the dynamic import — the same gate as
 * the persistence routes.
 */
async function devMockStreamResponse(req: Request): Promise<Response | null> {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.NEXT_PUBLIC_DEV_TWEAKS !== "1"
  ) {
    return null;
  }
  const { chatDevMockStreamResponse } = await import(
    "@/features/chat/dev-fixtures"
  );
  return chatDevMockStreamResponse(req);
}

export async function POST(req: Request) {
  const staged = await devMockStreamResponse(req);
  if (staged != null) {
    return staged;
  }
  const body = await req.json().catch(() => null);
  if (body == null) {
    return jsonError("invalid_request", "Invalid JSON body", 400);
  }

  const isObjectBody =
    typeof body === "object" && body !== null && !Array.isArray(body);
  const rawWorkspaceResourceQuota = isObjectBody
    ? (body as Record<string, unknown>).workspaceResourceQuota
    : undefined;
  const chatBody = isObjectBody
    ? Object.fromEntries(
        Object.entries(body as Record<string, unknown>).filter(
          ([key]) => key !== "workspaceResourceQuota"
        )
      )
    : body;
  const parsed = chatStreamRequestSchema.safeParse(chatBody);
  if (!parsed.success) {
    return jsonError(
      "invalid_request",
      "Invalid chat request",
      400,
      parsed.error.flatten()
    );
  }
  const workspaceResourceQuota = workspaceResourceQuotaSnapshotSchema.safeParse(
    rawWorkspaceResourceQuota
  );
  const request: ChatStreamRequest = workspaceResourceQuota.success
    ? { ...parsed.data, workspaceResourceQuota: workspaceResourceQuota.data }
    : parsed.data;

  const authorization = await authorizeWorkspaceActor({
    appToken: appTokenFromRequest(req),
    encodedKubeconfig: request.encodedKubeconfig,
    expectedNamespace: request.namespace.trim() || undefined,
    normalizeNamespace: normalizeAssistantNamespace,
  });
  if (!authorization.ok) {
    return jsonError(
      authorization.code,
      authorization.message,
      authorization.status
    );
  }
  const actor: VerifiedAssistantConversationActor =
    verifiedPersonalResourceActor(authorization);
  // The chat turn is a natural observation point for the quota-exhausted
  // producer: the snapshot already crossed the server boundary here.
  if (workspaceResourceQuota.success) {
    observeWorkspaceQuotaQuietly({
      namespace: authorization.namespace,
      snapshot: workspaceResourceQuota.data,
    });
  }
  const kubeconfig = decodeKubeconfig(parsed.data.encodedKubeconfig);
  if (kubeconfig == null) {
    return jsonError(
      "authentication_required",
      "Authentication is required.",
      401
    );
  }
  return runChatPipeline({
    actor,
    cookieHeader: req.headers.get("cookie"),
    kubeconfig,
    request,
    requestAbortSignal: req.signal,
  });
}
