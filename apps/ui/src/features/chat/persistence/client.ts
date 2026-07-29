import type { UIMessage } from "ai";
import { z } from "zod";

import { personalResourceAuthHeaders } from "@/lib/personal-resource-headers";

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

/** Credentials every personal conversation fetcher sends (ADR-0059). */
export interface AssistantFetcherCredentials {
  appToken: string;
  kubeconfig: string;
  namespace: string;
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

export function fetchAssistantSession(
  credentials: AssistantFetcherCredentials
): Promise<AssistantSessionPayload | null> {
  return safeJsonGet(
    `/api/chat/session?namespace=${encodeURIComponent(credentials.namespace)}`,
    sessionResponseSchema,
    personalResourceAuthHeaders(credentials)
  );
}

/** `null` when the handler failed (HTTP error / parse failure), including DB unavailable (503). */
export async function fetchAssistantThreads(
  credentials: AssistantFetcherCredentials
): Promise<AssistantThreadDTO[] | null> {
  const data = await safeJsonGet(
    `/api/chat/threads?namespace=${encodeURIComponent(credentials.namespace)}`,
    threadsResponseSchema,
    personalResourceAuthHeaders(credentials)
  );
  return data === null ? null : data.threads;
}

export async function fetchAssistantThreadMessages(
  chatId: string,
  credentials: AssistantFetcherCredentials
): Promise<UIMessage[] | null> {
  const data = await safeJsonGet(
    `/api/chat/messages?chatId=${encodeURIComponent(chatId)}&namespace=${encodeURIComponent(credentials.namespace)}`,
    messagesResponseSchema,
    personalResourceAuthHeaders(credentials)
  );
  return data?.messages ?? null;
}
