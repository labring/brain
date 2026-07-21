import type { UIMessage } from "ai";
import { generateId } from "ai";
import { and, asc, desc, eq } from "drizzle-orm";

import type { AssistantPgDatabase } from "./db";
import {
  type AssistantChatRow,
  assistantChatMessages,
  assistantChats,
} from "./schema";
import type { AssistantConversationOwner } from "./types";

export type ThreadRow = AssistantChatRow;

const MAX_TITLE_LEN = 200;

export interface AssistantConversationRepository {
  ensureThreadForOwner: (input: {
    id: string;
    owner: AssistantConversationOwner;
    title: string;
  }) => Promise<boolean>;
  selectMessagesByOwner: (
    owner: AssistantConversationOwner,
    chatId: string
  ) => Promise<UIMessage[] | null>;
  selectThreadByOwner: (
    chatId: string,
    owner: AssistantConversationOwner
  ) => Promise<ThreadRow | null>;
  selectThreadsByOwner: (
    owner: AssistantConversationOwner
  ) => Promise<ThreadRow[]>;
  updateThreadAiTitleOnceForOwner: (
    owner: AssistantConversationOwner,
    chatId: string,
    title: string
  ) => Promise<boolean>;
  upsertMessageForOwner: (
    owner: AssistantConversationOwner,
    chatId: string,
    message: UIMessage
  ) => Promise<boolean>;
}

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

function ownedThreadWhere(chatId: string, owner: AssistantConversationOwner) {
  return and(
    eq(assistantChats.id, chatId),
    eq(assistantChats.namespace, owner.namespace),
    eq(assistantChats.workspaceActor, owner.workspaceActor)
  );
}

export function createAssistantConversationRepository(
  getDb: () => AssistantPgDatabase
): AssistantConversationRepository {
  const selectThreadByOwner = async (
    chatId: string,
    owner: AssistantConversationOwner
  ): Promise<ThreadRow | null> => {
    const [row] = await getDb()
      .select()
      .from(assistantChats)
      .where(ownedThreadWhere(chatId, owner))
      .limit(1);
    return row ?? null;
  };

  const selectThreadsByOwner = (
    owner: AssistantConversationOwner
  ): Promise<ThreadRow[]> =>
    getDb()
      .select()
      .from(assistantChats)
      .where(
        and(
          eq(assistantChats.namespace, owner.namespace),
          eq(assistantChats.workspaceActor, owner.workspaceActor)
        )
      )
      .orderBy(desc(assistantChats.updatedAt));

  const ensureThreadForOwner = async (input: {
    id: string;
    owner: AssistantConversationOwner;
    title: string;
  }): Promise<boolean> => {
    await getDb()
      .insert(assistantChats)
      .values({
        id: input.id,
        namespace: input.owner.namespace,
        workspaceActor: input.owner.workspaceActor,
        title: input.title,
        titleAiGenerated: false,
      })
      .onConflictDoNothing({ target: assistantChats.id });
    return (await selectThreadByOwner(input.id, input.owner)) != null;
  };

  const updateThreadAiTitleOnceForOwner = async (
    owner: AssistantConversationOwner,
    chatId: string,
    title: string
  ): Promise<boolean> => {
    const safe = title.trim().slice(0, MAX_TITLE_LEN);
    if (safe === "") {
      return false;
    }
    const result = await getDb()
      .update(assistantChats)
      .set({
        title: safe,
        titleAiGenerated: true,
        updatedAt: new Date(),
      })
      .where(
        and(
          ownedThreadWhere(chatId, owner),
          eq(assistantChats.titleAiGenerated, false)
        )
      )
      .returning({ id: assistantChats.id });
    return result.length > 0;
  };

  const selectMessagesByOwner = async (
    owner: AssistantConversationOwner,
    chatId: string
  ): Promise<UIMessage[] | null> => {
    if ((await selectThreadByOwner(chatId, owner)) == null) {
      return null;
    }
    const rows = await getDb()
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
  };

  const upsertMessageForOwner = (
    owner: AssistantConversationOwner,
    chatId: string,
    message: UIMessage
  ): Promise<boolean> => {
    const row = withPersistableId(message);
    const now = new Date();
    return getDb().transaction(async (tx) => {
      const [ownedThread] = await tx
        .select({ id: assistantChats.id })
        .from(assistantChats)
        .where(ownedThreadWhere(chatId, owner))
        .limit(1);
      if (ownedThread == null) {
        return false;
      }

      const persisted = await tx
        .insert(assistantChatMessages)
        .values({
          id: row.id,
          chatId,
          role: row.role,
          parts: row.parts,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: assistantChatMessages.id,
          set: {
            role: row.role,
            parts: row.parts,
          },
          setWhere: eq(assistantChatMessages.chatId, chatId),
        })
        .returning({ id: assistantChatMessages.id });
      if (persisted.length === 0) {
        return false;
      }

      await tx
        .update(assistantChats)
        .set({ updatedAt: now })
        .where(ownedThreadWhere(chatId, owner));
      return true;
    });
  };

  return {
    ensureThreadForOwner,
    selectMessagesByOwner,
    selectThreadByOwner,
    selectThreadsByOwner,
    updateThreadAiTitleOnceForOwner,
    upsertMessageForOwner,
  };
}
