import "server-only";

import type { UIMessage } from "ai";
import { generateId } from "ai";
import { and, asc, desc, eq } from "drizzle-orm";

import { getAssistantDb } from "./db";
import {
  type AssistantChatRow,
  assistantChatMessages,
  assistantChats,
} from "./schema";

export type ThreadRow = AssistantChatRow;

const MAX_TITLE_LEN = 200;

/** AI SDK/streaming occasionally yields messages without `id`; PK rows need a stable unique key. */
function withPersistableId(message: UIMessage): UIMessage {
  const id = message.id;
  if (typeof id === "string") {
    const trimmed = id.trim();
    if (trimmed !== "") {
      return { ...message, id: trimmed };
    }
  }
  const fresh = generateId();
  console.warn("[chat-persistence] message lacked id before persist:", {
    role: message.role,
    assignedId: fresh,
  });
  return { ...message, id: fresh };
}

export async function selectThreadById(
  chatId: string
): Promise<ThreadRow | null> {
  const [row] = await getAssistantDb()
    .select()
    .from(assistantChats)
    .where(eq(assistantChats.id, chatId))
    .limit(1);
  return row ?? null;
}

/** Threads owned by one user within a namespace bucket. Owner is a view partition, not a security filter (ADR 0047). */
export function selectThreadsByNamespaceAndOwner(
  namespaceKey: string,
  ownerKey: string
): Promise<ThreadRow[]> {
  return getAssistantDb()
    .select()
    .from(assistantChats)
    .where(
      and(
        eq(assistantChats.namespace, namespaceKey),
        eq(assistantChats.userId, ownerKey)
      )
    )
    .orderBy(desc(assistantChats.updatedAt));
}

/**
 * Insert a thread row unless one already exists. Threads materialize lazily on
 * the first message of a chat, so two concurrent first messages race here —
 * the loser must be a no-op, never an error.
 */
export async function insertThreadIfAbsent(input: {
  id: string;
  namespaceKey: string;
  ownerKey: string;
  title: string;
}): Promise<void> {
  await getAssistantDb()
    .insert(assistantChats)
    .values({
      id: input.id,
      namespace: input.namespaceKey,
      userId: input.ownerKey,
      title: input.title,
      titleAiGenerated: false,
    })
    .onConflictDoNothing({ target: assistantChats.id });
}

/**
 * Set an AI-derived title once. Wins-or-loses by `WHERE title_ai_generated = false`,
 * so concurrent post-stream callers cannot stomp each other.
 */
export async function updateThreadAiTitleOnce(
  chatId: string,
  title: string
): Promise<boolean> {
  const safe = title.trim().slice(0, MAX_TITLE_LEN);
  if (safe === "") {
    return false;
  }
  const result = await getAssistantDb()
    .update(assistantChats)
    .set({
      title: safe,
      titleAiGenerated: true,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(assistantChats.id, chatId),
        eq(assistantChats.titleAiGenerated, false)
      )
    )
    .returning({ id: assistantChats.id });
  return result.length > 0;
}

export async function selectMessagesByThread(
  chatId: string
): Promise<UIMessage[]> {
  const rows = await getAssistantDb()
    .select()
    .from(assistantChatMessages)
    .where(eq(assistantChatMessages.chatId, chatId))
    .orderBy(
      asc(assistantChatMessages.createdAt),
      asc(assistantChatMessages.id)
    );
  return rows.map((row) => ({
    id: row.id,
    role: row.role,
    parts: row.parts,
  }));
}

/** Insert-or-replace a message and bump the parent thread's `updatedAt`. */
export async function upsertMessage(
  chatId: string,
  message: UIMessage
): Promise<void> {
  const row = withPersistableId(message);
  const insertedAt = new Date();
  const now = insertedAt;
  await getAssistantDb().transaction(async (tx) => {
    await tx
      .insert(assistantChatMessages)
      .values({
        id: row.id,
        chatId,
        role: row.role,
        parts: row.parts,
        createdAt: insertedAt,
      })
      .onConflictDoUpdate({
        target: assistantChatMessages.id,
        set: {
          chatId,
          role: row.role,
          parts: row.parts,
        },
      });
    await tx
      .update(assistantChats)
      .set({ updatedAt: now })
      .where(eq(assistantChats.id, chatId));
  });
}
