import {
  appendMessage,
  loadMessagesInNamespace,
  threadBelongsToNamespace,
} from "@/lib/chat-persistence/service";
import {
  appendMessageBodySchema,
  isAppendableAssistantEventMessage,
  isPersistedUIMessage,
} from "@/lib/chat-persistence/types";
import { jsonError } from "@/lib/chat-runtime/errors";

/** Full ordered history for `?chatId=` (and `?namespace=` for access control). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const chatId = url.searchParams.get("chatId")?.trim();
  const namespaceRaw = url.searchParams.get("namespace") ?? "";
  if (!chatId) {
    return jsonError("chatId query parameter required", 400);
  }

  try {
    const messages = await loadMessagesInNamespace(chatId, namespaceRaw);
    if (messages == null) {
      return Response.json(
        { error: "Thread not found for this namespace", messages: [] },
        { status: 404 }
      );
    }
    return Response.json({ messages });
  } catch (error) {
    console.error("[api/chat/messages]", error);
    return Response.json({
      messages: [],
      error: "Assistant chat persistence is unavailable (check DATABASE_URL).",
    });
  }
}

/** Persist one externally-created UI message into an existing assistant thread. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = appendMessageBodySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("Invalid body", 400, parsed.error.flatten());
  }

  if (!isPersistedUIMessage(parsed.data.message)) {
    return jsonError("Invalid message", 400);
  }
  if (
    parsed.data.message.role !== "user" &&
    !isAppendableAssistantEventMessage(parsed.data.message)
  ) {
    return jsonError(
      "Only user messages or assistant event messages accepted.",
      400
    );
  }

  try {
    if (
      !(await threadBelongsToNamespace(
        parsed.data.chatId,
        parsed.data.namespace
      ))
    ) {
      return jsonError(
        "Unknown or inaccessible assistant thread for this namespace.",
        404
      );
    }

    await appendMessage(parsed.data.chatId, parsed.data.message);
    return Response.json({ ok: true });
  } catch (error) {
    console.error("[api/chat/messages] append", error);
    return jsonError("Could not persist assistant message.", 503);
  }
}
