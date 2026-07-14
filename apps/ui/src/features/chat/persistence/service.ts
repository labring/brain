import "server-only";

import { generateId, type generateText, type UIMessage } from "ai";

import { getFreeTierSnapshot, isSystemOpenAiConfigured } from "./free-tier";
import {
  insertThreadIfAbsent,
  selectMessagesByThread,
  selectThreadById,
  selectThreadsByNamespaceAndOwner,
  type ThreadRow,
  updateThreadAiTitleOnce,
  upsertMessage,
} from "./repository";
import { deriveThreadTitle, placeholderThreadTitle } from "./title";
import {
  type AssistantSessionPayload,
  type AssistantThreadDTO,
  normalizeAssistantNamespace,
  normalizeAssistantOwner,
} from "./types";

type ChatTitleModel = Parameters<typeof generateText>[0]["model"];

function toThreadDTO(row: ThreadRow): AssistantThreadDTO {
  return {
    id: row.id,
    namespace: row.namespace,
    title: row.title,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toThreadDTOs(rows: ThreadRow[]): AssistantThreadDTO[] {
  return rows.map(toThreadDTO);
}

/** List one user's threads in a namespace bucket newest-first (owner is a view partition, ADR 0047). */
export async function listThreadsForNamespace(
  namespaceRaw: string,
  userIdRaw: string
): Promise<AssistantThreadDTO[]> {
  const key = normalizeAssistantNamespace(namespaceRaw);
  const owner = normalizeAssistantOwner(userIdRaw);
  return toThreadDTOs(await selectThreadsByNamespaceAndOwner(key, owner));
}

/**
 * Latest thread + messages + thread list for one owner. Threads materialize
 * lazily on the first message (`ensureThreadInNamespace`), so an owner with no
 * threads gets a draft: a fresh id with no messages and NO persisted row.
 */
export async function bootstrapAssistantSession(
  namespaceRaw: string,
  userIdRaw: string
): Promise<AssistantSessionPayload> {
  const key = normalizeAssistantNamespace(namespaceRaw);
  const owner = normalizeAssistantOwner(userIdRaw);
  const rows = await selectThreadsByNamespaceAndOwner(key, owner);
  // Entitlement (Free Chat Turns) stays per-namespace, not per-owner (ADR 0047).
  const snapshot = await getFreeTierSnapshot(key);
  const freeTier = {
    billing: (snapshot.remaining > 0 && isSystemOpenAiConfigured()
      ? "free"
      : "user") as "free" | "user",
    remaining: snapshot.remaining,
    limit: snapshot.limit,
  };
  const latest = rows[0];
  if (latest === undefined) {
    return {
      chatId: generateId(),
      messages: [],
      threads: [],
      freeTier,
    };
  }
  return {
    chatId: latest.id,
    messages: await selectMessagesByThread(latest.id),
    threads: toThreadDTOs(rows),
    freeTier,
  };
}

/**
 * Materialize the thread for an incoming chat message (create-on-first-message).
 * Returns false when the id exists but belongs to another namespace bucket —
 * the caller must reject the request. Owner is a view partition (ADR 0047),
 * recorded at creation and never re-keyed.
 */
export async function ensureThreadInNamespace(
  chatId: string,
  namespaceRaw: string,
  userIdRaw: string
): Promise<boolean> {
  const key = normalizeAssistantNamespace(namespaceRaw);
  const existing = await selectThreadById(chatId);
  if (existing != null) {
    return existing.namespace === key;
  }
  await insertThreadIfAbsent({
    id: chatId,
    namespaceKey: key,
    ownerKey: normalizeAssistantOwner(userIdRaw),
    title: placeholderThreadTitle(),
  });
  // Re-read: a concurrent creator may have won the insert with different keys.
  const created = await selectThreadById(chatId);
  return created != null && created.namespace === key;
}

/** Returns messages, or `null` when the thread does not exist in the namespace. */
export async function loadMessagesInNamespace(
  chatId: string,
  namespaceRaw: string
): Promise<UIMessage[] | null> {
  const thread = await selectThreadById(chatId);
  if (
    thread == null ||
    thread.namespace !== normalizeAssistantNamespace(namespaceRaw)
  ) {
    return null;
  }
  return selectMessagesByThread(chatId);
}

/** Returns true iff the thread exists *and* belongs to the namespace bucket. */
export async function threadBelongsToNamespace(
  chatId: string,
  namespaceRaw: string
): Promise<boolean> {
  const thread = await selectThreadById(chatId);
  return (
    thread != null &&
    thread.namespace === normalizeAssistantNamespace(namespaceRaw)
  );
}

/** Persist any UI message (user-inbound or assistant-completion) and bump the thread. */
export function appendMessage(
  chatId: string,
  message: UIMessage
): Promise<void> {
  return upsertMessage(chatId, message);
}

/** Load the full ordered history for one thread (no namespace check). */
export function loadThreadMessages(chatId: string): Promise<UIMessage[]> {
  return selectMessagesByThread(chatId);
}

/**
 * After the assistant's first reply finishes, derive a real title with the LLM
 * and persist it (race-safe single-write). No-op if a title was already set.
 * `projectName` is the display name of the project the request was sent from,
 * handed through so the title can mention it without inferring it.
 */
export async function maybeAutoTitleThread(input: {
  chatId: string;
  languageModel: ChatTitleModel;
  projectName?: string;
}): Promise<void> {
  const thread = await selectThreadById(input.chatId);
  if (thread == null || thread.titleAiGenerated) {
    return;
  }
  const messages = await selectMessagesByThread(input.chatId);
  const title = await deriveThreadTitle({
    languageModel: input.languageModel,
    messages,
    projectName: input.projectName,
  });
  await updateThreadAiTitleOnce(input.chatId, title);
}
