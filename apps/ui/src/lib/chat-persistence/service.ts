import "server-only";

import { generateId, type generateText, type UIMessage } from "ai";

import { getFreeTierSnapshot, isSystemOpenAiConfigured } from "./free-tier";
import {
  insertThread,
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

/** Create an empty thread owned by the caller; returns the new id and the refreshed thread list. */
export async function createThreadForNamespace(
  namespaceRaw: string,
  userIdRaw: string
): Promise<{
  chatId: string;
  threads: AssistantThreadDTO[];
}> {
  const key = normalizeAssistantNamespace(namespaceRaw);
  const owner = normalizeAssistantOwner(userIdRaw);
  const chatId = generateId();
  await insertThread({
    id: chatId,
    namespaceKey: key,
    ownerKey: owner,
    title: placeholderThreadTitle(),
  });
  return {
    chatId,
    threads: toThreadDTOs(await selectThreadsByNamespaceAndOwner(key, owner)),
  };
}

/** Latest thread + messages + thread list for one owner; bootstraps a first thread when none exists. */
export async function bootstrapAssistantSession(
  namespaceRaw: string,
  userIdRaw: string
): Promise<AssistantSessionPayload> {
  const key = normalizeAssistantNamespace(namespaceRaw);
  const owner = normalizeAssistantOwner(userIdRaw);
  let rows = await selectThreadsByNamespaceAndOwner(key, owner);
  if (rows.length === 0) {
    await insertThread({
      id: generateId(),
      namespaceKey: key,
      ownerKey: owner,
      title: placeholderThreadTitle(),
    });
    rows = await selectThreadsByNamespaceAndOwner(key, owner);
  }
  const latest = rows[0];
  if (!latest) {
    throw new Error("Failed to bootstrap assistant chat thread");
  }
  // Entitlement (Free Chat Turns) stays per-namespace, not per-owner (ADR 0047).
  const snapshot = await getFreeTierSnapshot(key);
  const billing =
    snapshot.remaining > 0 && isSystemOpenAiConfigured() ? "free" : "user";
  return {
    chatId: latest.id,
    messages: await selectMessagesByThread(latest.id),
    threads: toThreadDTOs(rows),
    freeTier: {
      billing,
      remaining: snapshot.remaining,
      limit: snapshot.limit,
    },
  };
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
 */
export async function maybeAutoTitleThread(input: {
  chatId: string;
  languageModel: ChatTitleModel;
}): Promise<void> {
  const thread = await selectThreadById(input.chatId);
  if (thread == null || thread.titleAiGenerated) {
    return;
  }
  const messages = await selectMessagesByThread(input.chatId);
  const title = await deriveThreadTitle({
    languageModel: input.languageModel,
    messages,
  });
  await updateThreadAiTitleOnce(input.chatId, title);
}
