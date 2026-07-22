import type { UIMessage } from "ai";
import { generateId } from "ai";
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";

import type { AssistantPgDatabase, AssistantPgTransaction } from "./db";
import {
  type AssistantChatRow,
  assistantChatMessages,
  assistantChats,
} from "./schema";
import type { AssistantConversationOwner } from "./types";

export type ThreadRow = AssistantChatRow;

const CHAT_STREAM_LEASE_MESSAGE_PREFIX = "__chat_stream_lease__:";
const CHAT_STREAM_LEASE_PART_TYPE = "data-chatStreamLease";
const CHAT_STREAM_LEASE_TTL_MS = 180_000;
const MAX_TITLE_LEN = 200;

export interface ChatStreamLease {
  chatId: string;
  messageId: string;
  owner: AssistantConversationOwner;
  parts: UIMessage["parts"];
  token: string;
}

export interface AssistantMessagePartsReplacement {
  expectedParts: UIMessage["parts"];
  messageId: string;
  replacementParts: UIMessage["parts"];
}

class ChatStreamCommitConflict extends Error {}

export interface AssistantConversationRepository {
  commitChatMessagesIfLeaseOwned: (input: {
    lease: ChatStreamLease;
    replacements: AssistantMessagePartsReplacement[];
    upsertMessage?: UIMessage;
  }) => Promise<ChatStreamLease | null>;
  ensureThreadForOwner: (input: {
    id: string;
    owner: AssistantConversationOwner;
    title: string;
  }) => Promise<boolean>;
  persistAssistantMessageIfLeaseOwned: (input: {
    lease: ChatStreamLease;
    message: UIMessage;
  }) => Promise<boolean>;
  releaseChatStreamLease: (lease: ChatStreamLease) => Promise<boolean>;
  replaceAssistantMessagePartsIfUnchanged: (input: {
    chatId: string;
    expectedParts: UIMessage["parts"];
    messageId: string;
    owner: AssistantConversationOwner;
    replacementParts: UIMessage["parts"];
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
  tryAcquireChatStreamLease: (input: {
    chatId: string;
    now?: Date;
    owner: AssistantConversationOwner;
    token?: string;
    ttlMs?: number;
  }) => Promise<ChatStreamLease | null>;
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

function chatStreamLeaseMessageId(chatId: string): string {
  return `${CHAT_STREAM_LEASE_MESSAGE_PREFIX}${chatId}`;
}

export function isChatStreamLeaseMessageId(messageId: string): boolean {
  return messageId.startsWith(CHAT_STREAM_LEASE_MESSAGE_PREFIX);
}

/** AI SDK messages need a stable non-reserved primary key before persistence. */
function withPersistableId(message: UIMessage): UIMessage {
  const id = message.id;
  if (typeof id === "string") {
    const trimmed = id.trim();
    if (trimmed !== "" && !isChatStreamLeaseMessageId(trimmed)) {
      return { ...message, id: trimmed };
    }
  }
  const fresh = generateId();
  console.warn("[chat-persistence] message had no usable id before persist:", {
    role: message.role,
    assignedId: fresh,
  });
  return { ...message, id: fresh };
}

function chatStreamLeaseParts(input: {
  acquiredAt: Date;
  expiresAt: Date;
  token: string;
}): UIMessage["parts"] {
  return [
    {
      data: {
        acquiredAt: input.acquiredAt.toISOString(),
        expiresAt: input.expiresAt.toISOString(),
        token: input.token,
        version: 1,
      },
      type: CHAT_STREAM_LEASE_PART_TYPE,
    },
  ] as UIMessage["parts"];
}

function renewedChatStreamLeaseParts(token: string) {
  return sql<UIMessage["parts"]>`jsonb_build_array(
    jsonb_build_object(
      'data', jsonb_build_object(
        'acquiredAt', clock_timestamp(),
        'expiresAt', clock_timestamp() + (${CHAT_STREAM_LEASE_TTL_MS}::double precision * interval '1 millisecond'),
        'token', ${token}::text,
        'version', 1
      ),
      'type', ${CHAT_STREAM_LEASE_PART_TYPE}::text
    )
  )`;
}

function chatStreamLeaseExpiry(parts: UIMessage["parts"]): number | null {
  const part = parts.length === 1 ? parts[0] : undefined;
  if (part?.type !== CHAT_STREAM_LEASE_PART_TYPE) {
    return null;
  }
  const data = (part as { data?: unknown }).data;
  if (data == null || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }
  const expiresAt = (data as Record<string, unknown>).expiresAt;
  if (typeof expiresAt !== "string") {
    return null;
  }
  const timestamp = Date.parse(expiresAt);
  return Number.isFinite(timestamp) ? timestamp : null;
}

async function readDatabaseNow(db: AssistantPgDatabase): Promise<Date> {
  const result = (await db.execute(sql`select clock_timestamp() as now`)) as {
    rows: Array<{ now: Date | string }>;
  };
  const value = result.rows[0]?.now;
  const now = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(now.getTime())) {
    throw new Error("Database returned an invalid clock timestamp");
  }
  return now;
}

function ownedThreadWhere(chatId: string, owner: AssistantConversationOwner) {
  return and(
    eq(assistantChats.id, chatId),
    eq(assistantChats.namespace, owner.namespace),
    eq(assistantChats.workspaceActor, owner.workspaceActor)
  );
}

async function transactionOwnsThread(
  tx: AssistantPgTransaction,
  chatId: string,
  owner: AssistantConversationOwner
): Promise<boolean> {
  const [thread] = await tx
    .select({ id: assistantChats.id })
    .from(assistantChats)
    .where(ownedThreadWhere(chatId, owner))
    .limit(1);
  return thread != null;
}

async function acquireChatStreamLeaseRow(
  tx: AssistantPgTransaction,
  lease: ChatStreamLease,
  now: Date
): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const inserted = await tx
      .insert(assistantChatMessages)
      .values({
        chatId: lease.chatId,
        createdAt: now,
        id: lease.messageId,
        parts: lease.parts,
        role: "system",
      })
      .onConflictDoNothing({ target: assistantChatMessages.id })
      .returning({ id: assistantChatMessages.id });
    if (inserted.length > 0) {
      return true;
    }

    const [existing] = await tx
      .select({ parts: assistantChatMessages.parts })
      .from(assistantChatMessages)
      .where(
        and(
          eq(assistantChatMessages.chatId, lease.chatId),
          eq(assistantChatMessages.id, lease.messageId)
        )
      )
      .limit(1);
    if (existing == null) {
      continue;
    }
    const expiry = chatStreamLeaseExpiry(existing.parts);
    if (expiry != null && expiry > now.getTime()) {
      return false;
    }

    const replaced = await tx
      .update(assistantChatMessages)
      .set({ createdAt: now, parts: lease.parts, role: "system" })
      .where(
        and(
          eq(assistantChatMessages.chatId, lease.chatId),
          eq(assistantChatMessages.id, lease.messageId),
          sql`${assistantChatMessages.parts} = ${JSON.stringify(existing.parts)}::jsonb`
        )
      )
      .returning({ id: assistantChatMessages.id });
    if (replaced.length > 0) {
      return true;
    }
  }
  return false;
}

async function replaceAssistantMessageParts(
  tx: AssistantPgTransaction,
  chatId: string,
  replacements: AssistantMessagePartsReplacement[]
): Promise<boolean> {
  for (const replacement of replacements) {
    const updated = await tx
      .update(assistantChatMessages)
      .set({ parts: replacement.replacementParts })
      .where(
        and(
          eq(assistantChatMessages.chatId, chatId),
          eq(assistantChatMessages.id, replacement.messageId),
          eq(assistantChatMessages.role, "assistant"),
          sql`${assistantChatMessages.parts} = ${JSON.stringify(replacement.expectedParts)}::jsonb`
        )
      )
      .returning({ id: assistantChatMessages.id });
    if (updated.length === 0) {
      return false;
    }
  }
  return true;
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
      .where(
        and(
          eq(assistantChatMessages.chatId, chatId),
          ne(assistantChatMessages.id, chatStreamLeaseMessageId(chatId))
        )
      )
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
      if (!(await transactionOwnsThread(tx, chatId, owner))) {
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

  const replaceAssistantMessagePartsIfUnchanged = (input: {
    chatId: string;
    expectedParts: UIMessage["parts"];
    messageId: string;
    owner: AssistantConversationOwner;
    replacementParts: UIMessage["parts"];
  }): Promise<boolean> => {
    const now = new Date();
    return getDb().transaction(async (tx) => {
      if (!(await transactionOwnsThread(tx, input.chatId, input.owner))) {
        return false;
      }

      const updated = await tx
        .update(assistantChatMessages)
        .set({ parts: input.replacementParts })
        .where(
          and(
            eq(assistantChatMessages.chatId, input.chatId),
            eq(assistantChatMessages.id, input.messageId),
            eq(assistantChatMessages.role, "assistant"),
            sql`${assistantChatMessages.parts} = ${JSON.stringify(input.expectedParts)}::jsonb`
          )
        )
        .returning({ id: assistantChatMessages.id });
      if (updated.length === 0) {
        return false;
      }

      await tx
        .update(assistantChats)
        .set({ updatedAt: now })
        .where(ownedThreadWhere(input.chatId, input.owner));
      return true;
    });
  };

  const tryAcquireChatStreamLease = async (input: {
    chatId: string;
    now?: Date;
    owner: AssistantConversationOwner;
    token?: string;
    ttlMs?: number;
  }): Promise<ChatStreamLease | null> => {
    const now = input.now ?? (await readDatabaseNow(getDb()));
    const token = input.token ?? generateId();
    const ttlMs = input.ttlMs ?? CHAT_STREAM_LEASE_TTL_MS;
    const messageId = chatStreamLeaseMessageId(input.chatId);
    const parts = chatStreamLeaseParts({
      acquiredAt: now,
      expiresAt: new Date(now.getTime() + ttlMs),
      token,
    });
    const lease: ChatStreamLease = {
      chatId: input.chatId,
      messageId,
      owner: { ...input.owner },
      parts,
      token,
    };

    return getDb().transaction(async (tx) => {
      if (!(await transactionOwnsThread(tx, input.chatId, input.owner))) {
        return null;
      }
      return (await acquireChatStreamLeaseRow(tx, lease, now)) ? lease : null;
    });
  };

  const commitChatMessagesIfLeaseOwned = (input: {
    lease: ChatStreamLease;
    replacements: AssistantMessagePartsReplacement[];
    upsertMessage?: UIMessage;
  }): Promise<ChatStreamLease | null> => {
    const row =
      input.upsertMessage == null
        ? undefined
        : withPersistableId(input.upsertMessage);

    return getDb()
      .transaction(async (tx) => {
        if (
          !(await transactionOwnsThread(
            tx,
            input.lease.chatId,
            input.lease.owner
          ))
        ) {
          throw new ChatStreamCommitConflict();
        }

        const owned = await tx
          .update(assistantChatMessages)
          .set({
            createdAt: sql`clock_timestamp()`,
            parts: renewedChatStreamLeaseParts(input.lease.token),
          })
          .where(
            and(
              eq(assistantChatMessages.chatId, input.lease.chatId),
              eq(assistantChatMessages.id, input.lease.messageId),
              sql`${assistantChatMessages.parts} = ${JSON.stringify(input.lease.parts)}::jsonb`,
              sql`(${assistantChatMessages.parts} #>> '{0,data,expiresAt}')::timestamptz > clock_timestamp()`
            )
          )
          .returning({ parts: assistantChatMessages.parts });
        const renewedParts = owned[0]?.parts;
        if (renewedParts == null) {
          throw new ChatStreamCommitConflict();
        }
        const renewedLease = { ...input.lease, parts: renewedParts };

        if (
          !(await replaceAssistantMessageParts(
            tx,
            input.lease.chatId,
            input.replacements
          ))
        ) {
          throw new ChatStreamCommitConflict();
        }

        if (row != null) {
          const persisted = await tx
            .insert(assistantChatMessages)
            .values({
              id: row.id,
              chatId: input.lease.chatId,
              role: row.role,
              parts: row.parts,
              createdAt: sql`clock_timestamp()`,
            })
            .onConflictDoUpdate({
              target: assistantChatMessages.id,
              set: {
                role: row.role,
                parts: row.parts,
              },
              setWhere: eq(assistantChatMessages.chatId, input.lease.chatId),
            })
            .returning({ id: assistantChatMessages.id });
          if (persisted.length === 0) {
            throw new ChatStreamCommitConflict();
          }
        }

        if (input.replacements.length > 0 || row != null) {
          await tx
            .update(assistantChats)
            .set({ updatedAt: sql`clock_timestamp()` })
            .where(ownedThreadWhere(input.lease.chatId, input.lease.owner));
        }
        return renewedLease;
      })
      .catch((error: unknown) => {
        if (error instanceof ChatStreamCommitConflict) {
          return null;
        }
        throw error;
      });
  };

  const releaseChatStreamLease = (lease: ChatStreamLease): Promise<boolean> =>
    getDb().transaction(async (tx) => {
      if (!(await transactionOwnsThread(tx, lease.chatId, lease.owner))) {
        return false;
      }

      const released = await tx
        .delete(assistantChatMessages)
        .where(
          and(
            eq(assistantChatMessages.chatId, lease.chatId),
            eq(assistantChatMessages.id, lease.messageId),
            sql`${assistantChatMessages.parts} = ${JSON.stringify(lease.parts)}::jsonb`
          )
        )
        .returning({ id: assistantChatMessages.id });
      return released.length > 0;
    });

  const persistAssistantMessageIfLeaseOwned = (input: {
    lease: ChatStreamLease;
    message: UIMessage;
  }): Promise<boolean> => {
    const row = withPersistableId(input.message);
    const now = new Date();
    return getDb().transaction(async (tx) => {
      if (
        !(await transactionOwnsThread(
          tx,
          input.lease.chatId,
          input.lease.owner
        ))
      ) {
        return false;
      }

      const owned = await tx
        .update(assistantChatMessages)
        .set({ parts: input.lease.parts })
        .where(
          and(
            eq(assistantChatMessages.chatId, input.lease.chatId),
            eq(assistantChatMessages.id, input.lease.messageId),
            sql`${assistantChatMessages.parts} = ${JSON.stringify(input.lease.parts)}::jsonb`,
            sql`(${assistantChatMessages.parts} #>> '{0,data,expiresAt}')::timestamptz > clock_timestamp()`
          )
        )
        .returning({ id: assistantChatMessages.id });
      if (owned.length === 0) {
        return false;
      }

      const persisted = await tx
        .insert(assistantChatMessages)
        .values({
          id: row.id,
          chatId: input.lease.chatId,
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
          setWhere: eq(assistantChatMessages.chatId, input.lease.chatId),
        })
        .returning({ id: assistantChatMessages.id });
      if (persisted.length === 0) {
        return false;
      }

      await tx
        .update(assistantChats)
        .set({ updatedAt: now })
        .where(ownedThreadWhere(input.lease.chatId, input.lease.owner));
      return true;
    });
  };

  return {
    commitChatMessagesIfLeaseOwned,
    ensureThreadForOwner,
    persistAssistantMessageIfLeaseOwned,
    releaseChatStreamLease,
    replaceAssistantMessagePartsIfUnchanged,
    selectMessagesByOwner,
    selectThreadByOwner,
    selectThreadsByOwner,
    updateThreadAiTitleOnceForOwner,
    upsertMessageForOwner,
    tryAcquireChatStreamLease,
  };
}
