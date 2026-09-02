import type { UIMessage } from "ai";
import { generateId } from "ai";
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";

import { requireCurrentIdentityBinding } from "@/lib/identity-fingerprint-core";

import type { AssistantPgDatabase, AssistantPgTransaction } from "./db";
import {
  type AssistantChatRow,
  assistantChatMessages,
  assistantChats,
} from "./schema";
import type {
  AssistantConversationScope,
  VerifiedAssistantConversationActor,
} from "./types";

export type ThreadRow = AssistantChatRow;

const CHAT_STREAM_LEASE_MESSAGE_PREFIX = "__chat_stream_lease__:";
const CHAT_STREAM_LEASE_PART_TYPE = "data-chatStreamLease";
const CHAT_STREAM_LEASE_TTL_MS = 180_000;
const MAX_TITLE_LEN = 200;
const PROJECT_ID_REQUIRED_MESSAGE = "assistant project id is required";

export interface ChatStreamLease {
  chatId: string;
  messageId: string;
  parts: UIMessage["parts"];
  scope: AssistantConversationScope;
  token: string;
}

export interface AssistantMessagePartsReplacement {
  expectedParts: UIMessage["parts"];
  messageId: string;
  replacementParts: UIMessage["parts"];
}

class ChatStreamCommitConflict extends Error {}

export interface AssistantConversationRepository {
  adoptLegacyThreadsForActor: (
    actor: VerifiedAssistantConversationActor
  ) => Promise<void>;
  commitChatMessagesIfLeaseOwned: (input: {
    lease: ChatStreamLease;
    replacements: AssistantMessagePartsReplacement[];
    upsertMessage?: UIMessage;
  }) => Promise<ChatStreamLease | null>;
  ensureThreadForOwner: (input: {
    actor: VerifiedAssistantConversationActor;
    id: string;
    projectId: string;
    title: string;
  }) => Promise<boolean>;
  persistAssistantMessageIfLeaseOwned: (input: {
    lease: ChatStreamLease;
    message: UIMessage;
  }) => Promise<boolean>;
  releaseChatStreamLease: (lease: ChatStreamLease) => Promise<boolean>;
  renewChatStreamLease: (
    lease: ChatStreamLease
  ) => Promise<ChatStreamLease | null>;
  replaceAssistantMessagePartsIfUnchanged: (input: {
    chatId: string;
    expectedParts: UIMessage["parts"];
    messageId: string;
    scope: AssistantConversationScope;
    replacementParts: UIMessage["parts"];
  }) => Promise<boolean>;
  selectMessagesByOwner: (
    scope: AssistantConversationScope,
    chatId: string
  ) => Promise<UIMessage[] | null>;
  selectThreadByOwner: (
    chatId: string,
    scope: AssistantConversationScope
  ) => Promise<ThreadRow | null>;
  selectThreadsByOwner: (
    scope: AssistantConversationScope
  ) => Promise<ThreadRow[]>;
  tryAcquireChatStreamLease: (input: {
    chatId: string;
    now?: Date;
    scope: AssistantConversationScope;
    token?: string;
    ttlMs?: number;
  }) => Promise<ChatStreamLease | null>;
  updateThreadAiTitleOnceForOwner: (
    scope: AssistantConversationScope,
    chatId: string,
    title: string
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

function requiredProjectId(projectId: string): string {
  const normalized = projectId.trim();
  if (normalized === "") {
    throw new Error(PROJECT_ID_REQUIRED_MESSAGE);
  }
  return normalized;
}

function scopedThreadWhere(chatId: string, scope: AssistantConversationScope) {
  return and(
    eq(assistantChats.id, chatId),
    eq(assistantChats.namespace, scope.namespace),
    eq(assistantChats.workspaceActor, scope.userUid),
    eq(assistantChats.projectId, requiredProjectId(scope.projectId))
  );
}

async function transactionOwnsThread(
  tx: AssistantPgTransaction,
  chatId: string,
  scope: AssistantConversationScope
): Promise<boolean> {
  const [thread] = await tx
    .select({ id: assistantChats.id })
    .from(assistantChats)
    .where(scopedThreadWhere(chatId, scope))
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
    scope: AssistantConversationScope
  ): Promise<ThreadRow | null> => {
    const [row] = await getDb()
      .select()
      .from(assistantChats)
      .where(scopedThreadWhere(chatId, scope))
      .limit(1);
    return row ?? null;
  };

  const selectThreadsByOwner = (
    scope: AssistantConversationScope
  ): Promise<ThreadRow[]> =>
    getDb()
      .select()
      .from(assistantChats)
      .where(
        and(
          eq(assistantChats.namespace, scope.namespace),
          eq(assistantChats.workspaceActor, scope.userUid),
          eq(assistantChats.projectId, requiredProjectId(scope.projectId))
        )
      )
      .orderBy(desc(assistantChats.updatedAt));

  /**
   * Lazy re-key (ADR-0059): re-keys the verified actor's legacy crName-keyed
   * threads to the proven uid in one idempotent UPDATE. The nanoid crName and
   * UUID userUid formats are disjoint, so the update matches only legacy rows
   * and repeat requests are no-ops. `updatedAt` is left untouched so adoption
   * never reorders the thread picker.
   */
  const adoptLegacyThreadsForActor = async (
    actor: VerifiedAssistantConversationActor
  ): Promise<void> => {
    const legacyWorkspaceActor = actor.legacyWorkspaceActor.trim();
    const userUid = actor.owner.userUid.trim();
    if (legacyWorkspaceActor === "" || userUid === "") {
      throw new Error("A verified conversation actor identity is required.");
    }
    if (legacyWorkspaceActor === userUid) {
      return;
    }
    await getDb().transaction(async (tx) => {
      // Adoption keys legacy rows to this uid, so it must not run after a
      // merge tombstoned it — the survivor could never adopt them back.
      await requireCurrentIdentityBinding(tx, {
        crName: legacyWorkspaceActor,
        userUid,
      });
      await tx
        .update(assistantChats)
        .set({ workspaceActor: userUid })
        .where(
          and(
            eq(assistantChats.namespace, actor.owner.namespace),
            eq(assistantChats.workspaceActor, legacyWorkspaceActor)
          )
        );
    });
  };

  const ensureThreadForOwner = async (input: {
    actor: VerifiedAssistantConversationActor;
    id: string;
    projectId: string;
    title: string;
  }): Promise<boolean> => {
    const owner = input.actor.owner;
    const projectId = requiredProjectId(input.projectId);
    const scope = { ...owner, projectId };
    await getDb().transaction(async (tx) => {
      // A new thread row is keyed by this uid; re-check the fingerprint in
      // the same transaction so a concurrent merge either sweeps this row or
      // refuses the stale binding (ADR-0059).
      await requireCurrentIdentityBinding(tx, {
        crName: input.actor.legacyWorkspaceActor,
        userUid: owner.userUid,
      });
      await tx
        .insert(assistantChats)
        .values({
          id: input.id,
          namespace: owner.namespace,
          projectId,
          workspaceActor: owner.userUid,
          title: input.title,
          titleAiGenerated: false,
        })
        .onConflictDoNothing({ target: assistantChats.id });
    });
    return (await selectThreadByOwner(input.id, scope)) != null;
  };

  const updateThreadAiTitleOnceForOwner = async (
    scope: AssistantConversationScope,
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
          scopedThreadWhere(chatId, scope),
          eq(assistantChats.titleAiGenerated, false)
        )
      )
      .returning({ id: assistantChats.id });
    return result.length > 0;
  };

  const selectMessagesByOwner = async (
    scope: AssistantConversationScope,
    chatId: string
  ): Promise<UIMessage[] | null> => {
    if ((await selectThreadByOwner(chatId, scope)) == null) {
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

  const replaceAssistantMessagePartsIfUnchanged = (input: {
    chatId: string;
    expectedParts: UIMessage["parts"];
    messageId: string;
    scope: AssistantConversationScope;
    replacementParts: UIMessage["parts"];
  }): Promise<boolean> => {
    const now = new Date();
    return getDb().transaction(async (tx) => {
      if (!(await transactionOwnsThread(tx, input.chatId, input.scope))) {
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
        .where(scopedThreadWhere(input.chatId, input.scope));
      return true;
    });
  };

  const tryAcquireChatStreamLease = async (input: {
    chatId: string;
    now?: Date;
    scope: AssistantConversationScope;
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
      scope: { ...input.scope },
      parts,
      token,
    };

    return getDb().transaction(async (tx) => {
      if (!(await transactionOwnsThread(tx, input.chatId, input.scope))) {
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
            input.lease.scope
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
            .where(scopedThreadWhere(input.lease.chatId, input.lease.scope));
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
      if (!(await transactionOwnsThread(tx, lease.chatId, lease.scope))) {
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

  const renewChatStreamLease = (
    lease: ChatStreamLease
  ): Promise<ChatStreamLease | null> =>
    getDb().transaction(async (tx) => {
      if (!(await transactionOwnsThread(tx, lease.chatId, lease.scope))) {
        return null;
      }

      const renewed = await tx
        .update(assistantChatMessages)
        .set({
          createdAt: sql`clock_timestamp()`,
          parts: renewedChatStreamLeaseParts(lease.token),
        })
        .where(
          and(
            eq(assistantChatMessages.chatId, lease.chatId),
            eq(assistantChatMessages.id, lease.messageId),
            sql`${assistantChatMessages.parts} = ${JSON.stringify(lease.parts)}::jsonb`,
            sql`(${assistantChatMessages.parts} #>> '{0,data,expiresAt}')::timestamptz > clock_timestamp()`
          )
        )
        .returning({ parts: assistantChatMessages.parts });
      const parts = renewed[0]?.parts;
      return parts == null ? null : { ...lease, parts };
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
          input.lease.scope
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
        .where(scopedThreadWhere(input.lease.chatId, input.lease.scope));
      return true;
    });
  };

  return {
    adoptLegacyThreadsForActor,
    commitChatMessagesIfLeaseOwned,
    ensureThreadForOwner,
    persistAssistantMessageIfLeaseOwned,
    releaseChatStreamLease,
    renewChatStreamLease,
    replaceAssistantMessagePartsIfUnchanged,
    selectMessagesByOwner,
    selectThreadByOwner,
    selectThreadsByOwner,
    updateThreadAiTitleOnceForOwner,
    tryAcquireChatStreamLease,
  };
}
