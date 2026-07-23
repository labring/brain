import {
  convertToModelMessages,
  generateId,
  stepCountIs,
  streamText,
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
  appendMessageForOwner,
  ensureAssistantThreadForOwner,
  loadMessagesForOwner,
  maybeAutoTitleThread,
} from "@/features/chat/persistence/service";
import {
  type AssistantConversationOwner,
  buildAssistantApprovalResponseFromPending,
  chatStreamRequestSchema,
  findPendingApprovalMessageForResponse,
  isAssistantApprovalResponseMessage,
  isPersistedUIMessage,
  normalizeAssistantNamespace,
} from "@/features/chat/persistence/types";
import { attachToolDurationMetrics } from "@/features/chat/runtime/attach-tool-duration-metrics";
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

async function appendIncomingChatMessage(
  chatId: string,
  history: NonNullable<Awaited<ReturnType<typeof loadMessagesForOwner>>>,
  owner: AssistantConversationOwner,
  message: unknown
): Promise<Response | null> {
  if (!isPersistedUIMessage(message)) {
    return jsonError("Malformed UI message payload", 400);
  }

  if (message.role === "user") {
    return (await appendMessageForOwner(chatId, message, owner))
      ? null
      : jsonError("Assistant conversation not found.", 404);
  }

  if (!isAssistantApprovalResponseMessage(message)) {
    return jsonError(
      "Only user messages or valid tool approvals accepted.",
      400
    );
  }

  const pending = history.find((item) => item.id === message.id);
  let messageToAppend = buildAssistantApprovalResponseFromPending(
    pending,
    message
  );
  if (messageToAppend == null) {
    const recoverablePending = findPendingApprovalMessageForResponse(
      history,
      message
    );
    if (recoverablePending == null) {
      return jsonError(
        "Invalid or stale tool approval response for this assistant thread.",
        400
      );
    }
    messageToAppend = buildAssistantApprovalResponseFromPending(
      recoverablePending,
      { ...message, id: recoverablePending.id }
    );
  }
  if (messageToAppend == null) {
    return jsonError(
      "Invalid or stale tool approval response for this assistant thread.",
      400
    );
  }
  return (await appendMessageForOwner(chatId, messageToAppend, owner))
    ? null
    : jsonError("Assistant conversation not found.", 404);
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

  const { assistantContext, chatId, encodedKubeconfig, message, namespace } =
    parsed.data;

  const authorization = await authorizeWorkspaceActor({
    encodedKubeconfig,
    expectedNamespace: namespace.trim() || undefined,
    normalizeNamespace: normalizeAssistantNamespace,
  });
  if (!authorization.ok) {
    return jsonError(authorization.message, authorization.status);
  }
  const owner: AssistantConversationOwner = {
    namespace: authorization.namespace,
    workspaceActor: authorization.workspaceActor,
  };
  const kubeconfig = decodeKubeconfig(encodedKubeconfig);
  if (kubeconfig == null) {
    return jsonError("Authentication is required.", 401);
  }

  try {
    const threadReady = await ensureAssistantThreadForOwner(chatId, owner);
    if (!threadReady) {
      return jsonError("Assistant conversation not found.", 404);
    }

    const freeTier = await getFreeTierSnapshot(owner.namespace);
    const systemModelConfigured = isSystemOpenAiConfigured();
    const billing: ChatBillingMode = freeTierPosture(
      freeTier,
      systemModelConfigured
    ).billing;

    const storedHistory = await loadMessagesForOwner(chatId, owner);
    if (storedHistory == null) {
      return jsonError("Assistant conversation not found.", 404);
    }
    const appendError = await appendIncomingChatMessage(
      chatId,
      storedHistory,
      owner,
      message
    );
    if (appendError != null) {
      return appendError;
    }

    const history = await loadMessagesForOwner(chatId, owner);
    if (history == null) {
      return jsonError("Assistant conversation not found.", 404);
    }
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

    const toolDurationMsByCallId = new Map<string, number>();

    const result = streamText({
      model,
      system: systemPrompt,
      messages: await convertToModelMessages(
        withSelectedResourceContext(history),
        { tools }
      ),
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

    return result.toUIMessageStreamResponse({
      originalMessages: history,
      generateMessageId: generateId,
      headers: responseHeaders,
      onFinish: async ({ responseMessage }) => {
        try {
          const persisted = await appendMessageForOwner(
            chatId,
            attachToolDurationMetrics(responseMessage, toolDurationMsByCallId),
            owner
          );
          if (!persisted) {
            console.warn(
              "[api/chat] assistant response not persisted: conversation unavailable"
            );
            return;
          }
          if (billing === "free") {
            const consumed = await consumeFreeTurnIfAvailable(owner.namespace);
            if (!consumed) {
              console.warn(
                "[api/chat] free turn not recorded (limit reached concurrently):",
                owner.namespace
              );
            }
          }
          await maybeAutoTitleThread({
            chatId,
            languageModel: titleModel,
            owner,
            projectName: assistantContext?.projectName,
          });
        } catch (error) {
          console.error("[api/chat] persist assistant turn:", error);
        }
      },
    });
  } catch (error) {
    console.error("[api/chat] pipeline:", error);
    return jsonError(
      "Could not handle chat request (DATABASE_URL, schema migrations, or upstream).",
      503
    );
  }
}
