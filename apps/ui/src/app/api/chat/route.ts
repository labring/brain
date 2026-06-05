import {
  convertToModelMessages,
  generateId,
  stepCountIs,
  streamText,
} from "ai";
import {
  type ChatBillingMode,
  resolveChatOpenAiConnection,
} from "@/lib/ai-proxy/resolve-chat-open-ai-connection";
import {
  consumeFreeTurnIfAvailable,
  getFreeTierSnapshot,
  isSystemOpenAiConfigured,
} from "@/lib/chat-persistence/free-tier";
import {
  appendMessage,
  loadThreadMessages,
  maybeAutoTitleThread,
  threadBelongsToNamespace,
} from "@/lib/chat-persistence/service";
import {
  buildAssistantApprovalResponseFromPending,
  chatStreamRequestSchema,
  findPendingApprovalMessageForResponse,
  isAssistantApprovalResponseMessage,
  isPersistedUIMessage,
} from "@/lib/chat-persistence/types";
import { attachToolDurationMetrics } from "@/lib/chat-runtime/attach-tool-duration-metrics";
import { jsonError } from "@/lib/chat-runtime/errors";
import { createInjectToolDurationStreamTransform } from "@/lib/chat-runtime/inject-tool-duration-stream";
import { decodeKubeconfig } from "@/lib/chat-runtime/kubeconfig";
import {
  CHAT_MAX_STEPS,
  chatLanguageModel,
  threadTitleLanguageModel,
} from "@/lib/chat-runtime/model";
import { resolveAuthoritativeChatNamespace } from "@/lib/chat-runtime/resolve-chat-namespace";
import { buildChatToolset } from "@/lib/chat-runtime/tools";

export const maxDuration = 120;

async function appendIncomingChatMessage(
  chatId: string,
  history: Awaited<ReturnType<typeof loadThreadMessages>>,
  message: unknown
): Promise<Response | null> {
  if (!isPersistedUIMessage(message)) {
    return jsonError("Malformed UI message payload", 400);
  }

  if (message.role === "user") {
    await appendMessage(chatId, message);
    return null;
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
  await appendMessage(chatId, messageToAppend);
  return null;
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

  const kubeconfig = decodeKubeconfig(encodedKubeconfig);
  if (kubeconfig == null) {
    return jsonError("Missing or invalid kubeconfig", 400);
  }

  const namespaceResolved = await resolveAuthoritativeChatNamespace({
    encodedKubeconfig,
    clientNamespace: namespace,
  });
  if (!namespaceResolved.ok) {
    return jsonError(namespaceResolved.message, namespaceResolved.status);
  }
  const authoritativeNamespace = namespaceResolved.namespace;

  try {
    if (!(await threadBelongsToNamespace(chatId, authoritativeNamespace))) {
      return jsonError(
        "Unknown or inaccessible assistant thread for this namespace.",
        403
      );
    }

    const freeTier = await getFreeTierSnapshot(authoritativeNamespace);
    const billing: ChatBillingMode =
      freeTier.remaining > 0 && isSystemOpenAiConfigured() ? "free" : "user";

    const storedHistory = await loadThreadMessages(chatId);
    const appendError = await appendIncomingChatMessage(
      chatId,
      storedHistory,
      message
    );
    if (appendError != null) {
      return appendError;
    }

    const history = await loadThreadMessages(chatId);
    const { tools, systemPrompt } = await buildChatToolset({
      assistantContext,
      kubeconfig,
      kubernetesNamespace: authoritativeNamespace,
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
      messages: await convertToModelMessages(history, { tools }),
      tools,
      stopWhen: stepCountIs(CHAT_MAX_STEPS),
      experimental_transform: createInjectToolDurationStreamTransform(
        toolDurationMsByCallId
      ),
      experimental_onToolCallFinish: (event) => {
        toolDurationMsByCallId.set(event.toolCall.toolCallId, event.durationMs);
      },
    });

    const responseHeaders: Record<string, string> = {
      "X-Chat-Billing": billing,
      "X-Chat-Free-Remaining": String(
        billing === "free"
          ? Math.max(0, freeTier.remaining - 1)
          : freeTier.remaining
      ),
      "X-Chat-Free-Limit": String(freeTier.limit),
    };

    return result.toUIMessageStreamResponse({
      originalMessages: history,
      generateMessageId: generateId,
      headers: responseHeaders,
      onFinish: async ({ responseMessage }) => {
        try {
          await appendMessage(
            chatId,
            attachToolDurationMetrics(responseMessage, toolDurationMsByCallId)
          );
          if (billing === "free") {
            const consumed = await consumeFreeTurnIfAvailable(
              authoritativeNamespace
            );
            if (!consumed) {
              console.warn(
                "[api/chat] free turn not recorded (limit reached concurrently):",
                authoritativeNamespace
              );
            }
          }
          await maybeAutoTitleThread({
            chatId,
            languageModel: titleModel,
          });
        } catch (error) {
          console.error("[api/chat] persist assistant turn:", error);
        }
      },
    });
  } catch (error) {
    console.error("[api/chat] pipeline:", error);
    return jsonError(
      "Could not handle chat request (DATABASE_URL, drizzle db:push, or upstream).",
      503
    );
  }
}
