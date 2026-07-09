import type { UIMessage } from "ai";
import { z } from "zod";

import { kubeconfigBearerHeader } from "@/lib/kubeconfig-header";

import {
  type AssistantSessionPayload,
  type AssistantThreadDTO,
  assistantThreadDTOSchema,
} from "./types";

const uiMessageSchema = z
  .object({
    id: z.string(),
    role: z.enum(["user", "assistant", "system"]),
    parts: z.array(z.unknown()),
  })
  .passthrough() as unknown as z.ZodType<UIMessage>;

const freeTierSchema = z.object({
  billing: z.enum(["free", "user"]),
  remaining: z.number(),
  limit: z.number(),
});

const sessionResponseSchema = z.object({
  chatId: z.string(),
  messages: z.array(uiMessageSchema),
  threads: z.array(assistantThreadDTOSchema),
  freeTier: freeTierSchema,
}) satisfies z.ZodType<AssistantSessionPayload>;

const threadsResponseSchema = z.object({
  threads: z.array(assistantThreadDTOSchema),
});

const messagesResponseSchema = z.object({
  messages: z.array(uiMessageSchema),
});

const createThreadResponseSchema = z.object({
  chatId: z.string(),
  threads: z.array(assistantThreadDTOSchema),
});

/**
 * Namespace-scoped chat routes authorize the caller from the kubeconfig bearer
 * token (see `authorizeChatRequestNamespace`), so every request must carry it.
 */
function authHeaders(kubeconfig: string): Record<string, string> {
  return { Authorization: kubeconfigBearerHeader(kubeconfig) };
}

async function safeJsonGet<T>(
  url: string,
  schema: z.ZodType<T>,
  headers: Record<string, string>
): Promise<T | null> {
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      return null;
    }
    const parsed = schema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function safeJsonPost<T>(
  url: string,
  body: unknown,
  schema: z.ZodType<T>,
  headers: Record<string, string>
): Promise<T | null> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      return null;
    }
    const parsed = schema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function fetchAssistantSession(
  namespaceRaw: string,
  kubeconfig: string
): Promise<AssistantSessionPayload | null> {
  return safeJsonGet(
    `/api/chat/session?namespace=${encodeURIComponent(namespaceRaw)}`,
    sessionResponseSchema,
    authHeaders(kubeconfig)
  );
}

/** `null` when the handler failed (HTTP error / parse failure), including DB unavailable (503). */
export async function fetchAssistantThreads(
  namespaceRaw: string,
  kubeconfig: string
): Promise<AssistantThreadDTO[] | null> {
  const data = await safeJsonGet(
    `/api/chat/threads?namespace=${encodeURIComponent(namespaceRaw)}`,
    threadsResponseSchema,
    authHeaders(kubeconfig)
  );
  return data === null ? null : data.threads;
}

export async function fetchAssistantThreadMessages(
  chatId: string,
  namespaceRaw: string,
  kubeconfig: string
): Promise<UIMessage[] | null> {
  const data = await safeJsonGet(
    `/api/chat/messages?chatId=${encodeURIComponent(chatId)}&namespace=${encodeURIComponent(namespaceRaw)}`,
    messagesResponseSchema,
    authHeaders(kubeconfig)
  );
  return data?.messages ?? null;
}

export function createAssistantThread(
  namespaceRaw: string,
  kubeconfig: string
): Promise<{
  chatId: string;
  threads: AssistantThreadDTO[];
} | null> {
  return safeJsonPost(
    "/api/chat/thread",
    { namespace: namespaceRaw },
    createThreadResponseSchema,
    authHeaders(kubeconfig)
  );
}

export function appendAssistantThreadMessage(input: {
  chatId: string;
  kubeconfig: string;
  message: UIMessage;
  namespace: string;
}): Promise<{ ok: boolean } | null> {
  const { kubeconfig, ...body } = input;
  return safeJsonPost(
    "/api/chat/messages",
    body,
    z.object({ ok: z.literal(true) }),
    authHeaders(kubeconfig)
  );
}
