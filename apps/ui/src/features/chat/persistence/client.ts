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

const paidSourceSchema = z.enum(["ai-credits", "balance"]).nullable();
const wallCauseSchema = z
  .enum(["ai-credits", "balance", "allowance-trial", "allowance-plan"])
  .nullable();
const freeTierSchema = z.object({
  billing: z.enum(["free", "user"]),
  remaining: z.number(),
  limit: z.number(),
  paidSource: paidSourceSchema.optional(),
  wall: wallCauseSchema.optional(),
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

const freeTurnsUsageSchema = z.object({
  limit: z.number(),
  remaining: z.number(),
  used: z.number(),
});

export type FreeChatTurnsUsage = z.infer<typeof freeTurnsUsageSchema>;

/** Credentials every personal conversation fetcher sends (ADR-0059). */
export interface AssistantFetcherCredentials {
  appToken: string;
  kubeconfig: string;
  namespace: string;
  projectId: string;
}

type AssistantNamespaceCredentials = Omit<
  AssistantFetcherCredentials,
  "projectId"
>;

function assistantScopeQuery(credentials: AssistantFetcherCredentials): string {
  return `namespace=${encodeURIComponent(credentials.namespace)}&projectId=${encodeURIComponent(credentials.projectId)}`;
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
    `/api/chat/session?${assistantScopeQuery(credentials)}`,
    sessionResponseSchema,
    personalResourceAuthHeaders(credentials)
  );
}

/** `null` when the handler failed (HTTP error / parse failure), including DB unavailable (503). */
export async function fetchAssistantThreads(
  credentials: AssistantFetcherCredentials
): Promise<AssistantThreadDTO[] | null> {
  const data = await safeJsonGet(
    `/api/chat/threads?${assistantScopeQuery(credentials)}`,
    threadsResponseSchema,
    personalResourceAuthHeaders(credentials)
  );
  return data === null ? null : data.threads;
}

/**
 * Usage-only Free Chat Turns snapshot for the Billing Area's allowance card
 * (ADR-0065). `null` when the lookup failed — the card degrades quietly.
 */
export function fetchFreeChatTurnsUsage(
  credentials: AssistantNamespaceCredentials
): Promise<FreeChatTurnsUsage | null> {
  return safeJsonGet(
    `/api/chat/free-turns?namespace=${encodeURIComponent(credentials.namespace)}`,
    freeTurnsUsageSchema,
    personalResourceAuthHeaders(credentials)
  );
}

export async function fetchAssistantThreadMessages(
  chatId: string,
  credentials: AssistantFetcherCredentials
): Promise<UIMessage[] | null> {
  const data = await safeJsonGet(
    `/api/chat/messages?chatId=${encodeURIComponent(chatId)}&${assistantScopeQuery(credentials)}`,
    messagesResponseSchema,
    personalResourceAuthHeaders(credentials)
  );
  return data?.messages ?? null;
}
