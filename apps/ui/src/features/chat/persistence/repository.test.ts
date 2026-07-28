import {
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  test,
} from "bun:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { PGlite } from "@electric-sql/pglite";
import type { UIMessage } from "ai";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import {
  createAssistantConversationRepository,
  type ThreadRow,
} from "./repository-core";
import {
  assistantChatMessages,
  assistantChats,
  assistantEntitlements,
  githubAppInstallSessions,
  githubConnections,
  githubOauthConnections,
  identityFingerprints,
} from "./schema";

const assistantSchema = {
  assistantChatMessages,
  assistantChats,
  assistantEntitlements,
  githubAppInstallSessions,
  githubConnections,
  githubOauthConnections,
  identityFingerprints,
};
const mainPglite = new PGlite();
const db = drizzle(mainPglite, { schema: assistantSchema });

afterAll(() => mainPglite.close());

test("repository never exposes or mutates a foreign conversation", async () => {
  const migrationsFolder = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../drizzle"
  );
  await migrate(db, { migrationsFolder });
  const repository = createAssistantConversationRepository(() => db);
  const alice = { namespace: "shared", workspaceActor: "alice-uid" };
  const bob = { namespace: "shared", workspaceActor: "bob-uid" };

  assert.equal(
    await repository.ensureThreadForOwner({
      id: "bob-chat",
      owner: bob,
      title: "Bob title",
    }),
    true
  );
  await db.insert(assistantChatMessages).values({
    chatId: "bob-chat",
    id: "shared-message-id",
    role: "assistant",
    parts: [{ type: "text", text: "Bob secret" }],
  });
  assert.equal(
    await repository.ensureThreadForOwner({
      id: "alice-chat",
      owner: alice,
      title: "Alice title",
    }),
    true
  );
  assert.equal(
    await repository.ensureThreadForOwner({
      id: "bob-chat",
      owner: alice,
      title: "Re-keyed title",
    }),
    false
  );

  assert.equal(await repository.selectThreadByOwner("bob-chat", alice), null);
  assert.equal(await repository.selectMessagesByOwner(alice, "bob-chat"), null);
  assert.equal(
    await repository.updateThreadAiTitleOnceForOwner(
      alice,
      "bob-chat",
      "Stolen title"
    ),
    false
  );

  assert.deepEqual(await repository.selectMessagesByOwner(bob, "bob-chat"), [
    {
      id: "shared-message-id",
      role: "assistant",
      parts: [{ type: "text", text: "Bob secret" }],
    },
  ]);
  const bobThread = (await repository.selectThreadByOwner(
    "bob-chat",
    bob
  )) as ThreadRow;
  assert.equal(bobThread.title, "Bob title");
  assert.deepEqual(
    await repository.selectMessagesByOwner(alice, "alice-chat"),
    []
  );
});

test("ownership migration invalidates legacy conversations without resetting namespace Free Chat Turns", async () => {
  const legacyDb = new PGlite();
  const migrationsFolder = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../drizzle"
  );
  const applyMigration = async (name: string) => {
    const sql = await readFile(path.join(migrationsFolder, name), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      if (statement.trim() !== "") {
        await legacyDb.exec(statement);
      }
    }
  };

  try {
    for (const name of [
      "0000_baseline.sql",
      "0001_deploy_task_engine.sql",
      "0002_drop_deploy_task_heartbeat.sql",
      "0003_awesome_firebrand.sql",
      "0004_unknown_felicia_hardy.sql",
      "0005_faithful_hedge_knight.sql",
    ]) {
      await applyMigration(name);
    }
    await legacyDb.exec(`
      INSERT INTO sealai_assistant.assistant_chats
        (id, namespace, user_id, title)
      VALUES ('legacy-chat', 'shared', 'client-selected-user', 'Legacy');
      INSERT INTO sealai_assistant.assistant_chat_messages
        (id, chat_id, role, parts)
      VALUES ('legacy-message', 'legacy-chat', 'assistant', '[]'::jsonb);
      INSERT INTO sealai_assistant.assistant_entitlements
        (namespace, free_turns_used)
      VALUES ('shared', 4);
    `);

    await applyMigration("0006_bind_verified_workspace_actors.sql");

    const chats = await legacyDb.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM sealai_assistant.assistant_chats"
    );
    const messages = await legacyDb.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM sealai_assistant.assistant_chat_messages"
    );
    const entitlements = await legacyDb.query<{
      free_turns_used: number;
    }>(
      "SELECT free_turns_used FROM sealai_assistant.assistant_entitlements WHERE namespace = 'shared'"
    );
    const columns = await legacyDb.query<{ column_name: string }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'sealai_assistant'
        AND table_name = 'assistant_chats'
    `);

    assert.deepEqual(chats.rows, [{ count: 0 }]);
    assert.deepEqual(messages.rows, [{ count: 0 }]);
    assert.deepEqual(entitlements.rows, [{ free_turns_used: 4 }]);
    assert.equal(
      columns.rows.some((column) => column.column_name === "workspace_actor"),
      true
    );
    assert.equal(
      columns.rows.some((column) => column.column_name === "user_id"),
      false
    );
  } finally {
    await legacyDb.close();
  }
});

const TEST_CHAT_ID = "chat-cas";
const TEST_MESSAGE_ID = "message-cas";
const TEST_OWNER = {
  namespace: "ns-test",
  workspaceActor: "user-test",
} as const;
const OTHER_OWNER = {
  namespace: "ns-test",
  workspaceActor: "other-user",
} as const;
const INITIAL_UPDATED_AT = new Date("2026-01-01T00:00:00.000Z");
const expectedParts = [
  {
    input: { namespace: "ns-test" },
    state: "input-available",
    toolCallId: "call-test",
    type: "tool-refreshFrontendSwrCaches",
  },
] satisfies UIMessage["parts"];
const replacementParts = [
  {
    input: { namespace: "ns-test" },
    output: { scheduled: true },
    state: "output-available",
    toolCallId: "call-test",
    type: "tool-refreshFrontendSwrCaches",
  },
] satisfies UIMessage["parts"];

const pglite = new PGlite();
const testDb = drizzle(pglite, {
  schema: { assistantChatMessages, assistantChats },
});

mock.module("server-only", () => ({}));
mock.module("./db", () => ({ getAssistantDb: () => testDb }));

await migrate(testDb, {
  migrationsFolder: path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../drizzle"
  ),
});

const {
  assistantConversationRepository,
  commitChatMessagesIfLeaseOwned,
  persistAssistantMessageIfLeaseOwned,
  releaseChatStreamLease,
  renewChatStreamLease,
  replaceAssistantMessagePartsIfUnchanged:
    replaceAssistantMessagePartsIfUnchangedForOwner,
  tryAcquireChatStreamLease: tryAcquireChatStreamLeaseForOwner,
} = await import("./repository");

function replaceAssistantMessagePartsIfUnchanged(
  input: Omit<
    Parameters<typeof replaceAssistantMessagePartsIfUnchangedForOwner>[0],
    "owner"
  >
) {
  return replaceAssistantMessagePartsIfUnchangedForOwner({
    ...input,
    owner: TEST_OWNER,
  });
}

function tryAcquireChatStreamLease(
  input: Omit<Parameters<typeof tryAcquireChatStreamLeaseForOwner>[0], "owner">
) {
  return tryAcquireChatStreamLeaseForOwner({ ...input, owner: TEST_OWNER });
}

async function seedThread() {
  await testDb.insert(assistantChats).values({
    id: TEST_CHAT_ID,
    namespace: "ns-test",
    title: "CAS test",
    updatedAt: INITIAL_UPDATED_AT,
    workspaceActor: TEST_OWNER.workspaceActor,
  });
}

async function seedMessage(role: "assistant" | "user" = "assistant") {
  await seedThread();
  await testDb.insert(assistantChatMessages).values({
    chatId: TEST_CHAT_ID,
    id: TEST_MESSAGE_ID,
    parts: [...expectedParts],
    role,
  });
}

async function storedState() {
  const [message] = await testDb
    .select({ parts: assistantChatMessages.parts })
    .from(assistantChatMessages)
    .where(eq(assistantChatMessages.id, TEST_MESSAGE_ID));
  const [thread] = await testDb
    .select({ updatedAt: assistantChats.updatedAt })
    .from(assistantChats)
    .where(eq(assistantChats.id, TEST_CHAT_ID));
  return { message, thread };
}

async function storedMessageParts(messageId: string) {
  const [message] = await testDb
    .select({ parts: assistantChatMessages.parts })
    .from(assistantChatMessages)
    .where(eq(assistantChatMessages.id, messageId));
  return message?.parts;
}

beforeEach(async () => {
  await testDb.delete(assistantChatMessages);
  await testDb.delete(assistantChats);
});

afterAll(async () => {
  await pglite.close();
});

describe("replaceAssistantMessagePartsIfUnchanged", () => {
  it("replaces matching assistant parts and bumps the parent thread", async () => {
    await seedMessage();

    const replaced = await replaceAssistantMessagePartsIfUnchanged({
      chatId: TEST_CHAT_ID,
      expectedParts: [...expectedParts],
      messageId: TEST_MESSAGE_ID,
      replacementParts: [...replacementParts],
    });

    expect(replaced).toBe(true);
    const state = await storedState();
    expect(state.message?.parts).toEqual(replacementParts);
    expect(state.thread?.updatedAt.getTime()).toBeGreaterThan(
      INITIAL_UPDATED_AT.getTime()
    );
  });

  it("rejects stale and replayed snapshots without changing the row or thread", async () => {
    await seedMessage();
    const first = await replaceAssistantMessagePartsIfUnchanged({
      chatId: TEST_CHAT_ID,
      expectedParts: [...expectedParts],
      messageId: TEST_MESSAGE_ID,
      replacementParts: [...replacementParts],
    });
    expect(first).toBe(true);
    const replaySentinel = new Date("2030-01-01T00:00:00.000Z");
    await testDb
      .update(assistantChats)
      .set({ updatedAt: replaySentinel })
      .where(eq(assistantChats.id, TEST_CHAT_ID));
    const afterFirst = await storedState();

    const replay = await replaceAssistantMessagePartsIfUnchanged({
      chatId: TEST_CHAT_ID,
      expectedParts: [...expectedParts],
      messageId: TEST_MESSAGE_ID,
      replacementParts: [{ type: "text", text: "must not overwrite" }],
    });

    expect(replay).toBe(false);
    expect(await storedState()).toEqual(afterFirst);
  });

  it("lets only one of two concurrent replacements win", async () => {
    await seedMessage();
    const otherReplacement = [
      {
        input: { namespace: "ns-test" },
        output: { scheduled: false },
        state: "output-available",
        toolCallId: "call-test",
        type: "tool-refreshFrontendSwrCaches",
      },
    ] satisfies UIMessage["parts"];

    const results = await Promise.all([
      replaceAssistantMessagePartsIfUnchanged({
        chatId: TEST_CHAT_ID,
        expectedParts: [...expectedParts],
        messageId: TEST_MESSAGE_ID,
        replacementParts: [...replacementParts],
      }),
      replaceAssistantMessagePartsIfUnchanged({
        chatId: TEST_CHAT_ID,
        expectedParts: [...expectedParts],
        messageId: TEST_MESSAGE_ID,
        replacementParts: [...otherReplacement],
      }),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    const state = await storedState();
    expect(
      [replacementParts, otherReplacement].some((parts) =>
        isDeepStrictEqual(parts, state.message?.parts)
      )
    ).toBe(true);
    expect(state.thread?.updatedAt.getTime()).toBeGreaterThan(
      INITIAL_UPDATED_AT.getTime()
    );
  });

  it("does not update a non-assistant row or bump its thread", async () => {
    await seedMessage("user");

    const replaced = await replaceAssistantMessagePartsIfUnchanged({
      chatId: TEST_CHAT_ID,
      expectedParts: [...expectedParts],
      messageId: TEST_MESSAGE_ID,
      replacementParts: [...replacementParts],
    });

    expect(replaced).toBe(false);
    const state = await storedState();
    expect(state.message?.parts).toEqual(expectedParts);
    expect(state.thread?.updatedAt).toEqual(INITIAL_UPDATED_AT);
  });
});

describe("chat stream lease", () => {
  it("rejects renewal after the lease expires according to the database clock", async () => {
    await seedThread();
    const expired = await tryAcquireChatStreamLease({
      chatId: TEST_CHAT_ID,
      now: new Date("2001-01-01T00:00:00.000Z"),
      token: "lease-expired-renewal",
      ttlMs: 1000,
    });
    if (expired == null) {
      throw new Error("expected the expired lease fixture");
    }

    expect(await renewChatStreamLease(expired)).toBeNull();
  });

  it("allows one concurrent owner and stays hidden from normal history", async () => {
    await seedThread();
    const now = new Date("2026-01-01T00:00:01.000Z");

    const leases = await Promise.all([
      tryAcquireChatStreamLease({
        chatId: TEST_CHAT_ID,
        now,
        token: "lease-a",
      }),
      tryAcquireChatStreamLease({
        chatId: TEST_CHAT_ID,
        now,
        token: "lease-b",
      }),
    ]);

    const winners = leases.filter((lease) => lease != null);
    expect(winners).toHaveLength(1);
    expect(
      await assistantConversationRepository.selectMessagesByOwner(
        { namespace: "ns-test", workspaceActor: "user-test" },
        TEST_CHAT_ID
      )
    ).toEqual([]);
    const winner = winners[0];
    expect(winner).toBeDefined();
    if (winner == null) {
      throw new Error("expected one lease winner");
    }
    expect(await releaseChatStreamLease(winner)).toBe(true);
    expect(
      await tryAcquireChatStreamLease({
        chatId: TEST_CHAT_ID,
        now,
        token: "lease-after-release",
      })
    ).not.toBeNull();
  });

  it("lets an expired lease be stolen and rejects the old owner", async () => {
    await seedThread();
    const first = await tryAcquireChatStreamLease({
      chatId: TEST_CHAT_ID,
      now: new Date("2099-01-01T00:00:01.000Z"),
      token: "lease-old",
      ttlMs: 1000,
    });
    expect(first).not.toBeNull();
    const replacement = await tryAcquireChatStreamLease({
      chatId: TEST_CHAT_ID,
      now: new Date("2099-01-01T00:00:03.000Z"),
      token: "lease-new",
      ttlMs: 1000,
    });
    expect(replacement).not.toBeNull();
    if (first == null || replacement == null) {
      throw new Error("expected both lease acquisitions");
    }

    expect(
      await persistAssistantMessageIfLeaseOwned({
        lease: first,
        message: {
          id: "assistant-stale",
          parts: [{ text: "must not persist", type: "text" }],
          role: "assistant",
        },
      })
    ).toBe(false);
    expect(await releaseChatStreamLease(first)).toBe(false);
    expect(
      await persistAssistantMessageIfLeaseOwned({
        lease: replacement,
        message: {
          id: "assistant-current",
          parts: [{ text: "current response", type: "text" }],
          role: "assistant",
        },
      })
    ).toBe(true);
    expect(
      await assistantConversationRepository.selectMessagesByOwner(
        { namespace: "ns-test", workspaceActor: "user-test" },
        TEST_CHAT_ID
      )
    ).toEqual([
      {
        id: "assistant-current",
        parts: [{ text: "current response", type: "text" }],
        role: "assistant",
      },
    ]);
    expect(await releaseChatStreamLease(replacement)).toBe(true);
  });

  it("rejects renewal after another owner steals the lease", async () => {
    await seedThread();
    const first = await tryAcquireChatStreamLease({
      chatId: TEST_CHAT_ID,
      now: new Date("2099-01-01T00:00:00.000Z"),
      token: "lease-old-renewal",
      ttlMs: 1000,
    });
    const replacement = await tryAcquireChatStreamLease({
      chatId: TEST_CHAT_ID,
      now: new Date("2099-01-01T00:00:02.000Z"),
      token: "lease-new-renewal",
      ttlMs: 1000,
    });
    if (first == null || replacement == null) {
      throw new Error("expected the replacement lease fixture");
    }

    expect(await renewChatStreamLease(first)).toBeNull();
    expect(await releaseChatStreamLease(replacement)).toBe(true);
  });

  it("uses the database clock when deciding whether to steal an expired lease", async () => {
    await seedThread();
    const first = await tryAcquireChatStreamLease({
      chatId: TEST_CHAT_ID,
      now: new Date("2001-01-01T00:00:00.000Z"),
      token: "lease-before-db-clock",
      ttlMs: 1000,
    });
    expect(first).not.toBeNull();

    const replacement = await tryAcquireChatStreamLease({
      chatId: TEST_CHAT_ID,
      token: "lease-from-db-clock",
    });
    expect(replacement?.token).toBe("lease-from-db-clock");
    if (replacement != null) {
      expect(await releaseChatStreamLease(replacement)).toBe(true);
    }
  });

  it("rejects every lease and CAS operation for a foreign owner", async () => {
    await seedMessage();

    expect(
      await replaceAssistantMessagePartsIfUnchangedForOwner({
        chatId: TEST_CHAT_ID,
        expectedParts: [...expectedParts],
        messageId: TEST_MESSAGE_ID,
        owner: OTHER_OWNER,
        replacementParts: [...replacementParts],
      })
    ).toBe(false);
    expect(await storedMessageParts(TEST_MESSAGE_ID)).toEqual(expectedParts);
    expect(
      await tryAcquireChatStreamLeaseForOwner({
        chatId: TEST_CHAT_ID,
        owner: OTHER_OWNER,
        token: "foreign-acquire",
      })
    ).toBeNull();

    const lease = await tryAcquireChatStreamLease({
      chatId: TEST_CHAT_ID,
      token: "owned-lease",
    });
    if (lease == null) {
      throw new Error("expected the owned lease");
    }
    const foreignLease = { ...lease, owner: OTHER_OWNER };

    expect(
      await commitChatMessagesIfLeaseOwned({
        lease: foreignLease,
        replacements: [],
      })
    ).toBeNull();
    expect(
      await persistAssistantMessageIfLeaseOwned({
        lease: foreignLease,
        message: {
          id: "foreign-assistant",
          parts: [{ text: "must not persist", type: "text" }],
          role: "assistant",
        },
      })
    ).toBe(false);
    expect(await releaseChatStreamLease(foreignLease)).toBe(false);
    expect(await releaseChatStreamLease(lease)).toBe(true);
  });

  it("rejects an incoming commit after another owner steals the lease", async () => {
    await seedMessage();
    const first = await tryAcquireChatStreamLease({
      chatId: TEST_CHAT_ID,
      now: new Date("2099-01-01T00:00:01.000Z"),
      token: "lease-old-commit",
      ttlMs: 1000,
    });
    const replacement = await tryAcquireChatStreamLease({
      chatId: TEST_CHAT_ID,
      now: new Date("2099-01-01T00:00:03.000Z"),
      token: "lease-new-commit",
      ttlMs: 1000,
    });
    if (first == null || replacement == null) {
      throw new Error("expected the expired lease to be replaced");
    }

    const committed = await commitChatMessagesIfLeaseOwned({
      lease: first,
      replacements: [
        {
          expectedParts: [...expectedParts],
          messageId: TEST_MESSAGE_ID,
          replacementParts: [...replacementParts],
        },
      ],
      upsertMessage: {
        id: "user-from-stale-owner",
        parts: [{ text: "must not persist", type: "text" }],
        role: "user",
      },
    });

    expect(committed).toBeNull();
    expect(
      await assistantConversationRepository.selectMessagesByOwner(
        { namespace: "ns-test", workspaceActor: "user-test" },
        TEST_CHAT_ID
      )
    ).toEqual([
      {
        id: TEST_MESSAGE_ID,
        parts: expectedParts,
        role: "assistant",
      },
    ]);
    expect(await releaseChatStreamLease(replacement)).toBe(true);
  });

  it("rejects a rollback after another owner steals the lease", async () => {
    await seedMessage();
    const first = await tryAcquireChatStreamLease({
      chatId: TEST_CHAT_ID,
      now: new Date("2099-01-01T00:00:01.000Z"),
      token: "lease-old-rollback",
      ttlMs: 1000,
    });
    if (first == null) {
      throw new Error("expected the first lease");
    }
    const renewed = await commitChatMessagesIfLeaseOwned({
      lease: first,
      replacements: [
        {
          expectedParts: [...expectedParts],
          messageId: TEST_MESSAGE_ID,
          replacementParts: [...replacementParts],
        },
      ],
    });
    expect(renewed).not.toBeNull();

    const replacement = await tryAcquireChatStreamLease({
      chatId: TEST_CHAT_ID,
      now: new Date("2099-01-01T00:00:03.000Z"),
      token: "lease-new-rollback",
      ttlMs: 1000,
    });
    if (replacement == null) {
      throw new Error("expected the expired lease to be replaced");
    }

    expect(
      await commitChatMessagesIfLeaseOwned({
        lease: first,
        replacements: [
          {
            expectedParts: [...replacementParts],
            messageId: TEST_MESSAGE_ID,
            replacementParts: [...expectedParts],
          },
        ],
      })
    ).toBeNull();
    expect(await storedMessageParts(TEST_MESSAGE_ID)).toEqual(replacementParts);
    expect(await releaseChatStreamLease(replacement)).toBe(true);
  });

  it("rejects a commit after the lease expires even before takeover", async () => {
    await seedMessage();
    const expired = await tryAcquireChatStreamLease({
      chatId: TEST_CHAT_ID,
      now: new Date("2001-01-01T00:00:00.000Z"),
      token: "lease-expired-without-takeover",
      ttlMs: 1000,
    });
    if (expired == null) {
      throw new Error("expected the expired lease fixture");
    }

    expect(
      await commitChatMessagesIfLeaseOwned({
        lease: expired,
        replacements: [
          {
            expectedParts: [...expectedParts],
            messageId: TEST_MESSAGE_ID,
            replacementParts: [...replacementParts],
          },
        ],
      })
    ).toBeNull();
    expect(await storedMessageParts(TEST_MESSAGE_ID)).toEqual(expectedParts);
    expect(await releaseChatStreamLease(expired)).toBe(true);
  });

  it("rolls back every replacement and upsert when a later CAS conflicts", async () => {
    const secondMessageId = "message-cas-second";
    const concurrentParts = [
      { text: "changed concurrently", type: "text" as const },
    ];
    await seedMessage();
    await testDb.insert(assistantChatMessages).values({
      chatId: TEST_CHAT_ID,
      id: secondMessageId,
      parts: [...expectedParts],
      role: "assistant",
    });
    const lease = await tryAcquireChatStreamLease({
      chatId: TEST_CHAT_ID,
      token: "lease-atomic-commit",
    });
    if (lease == null) {
      throw new Error("expected the atomic commit lease");
    }
    await testDb
      .update(assistantChatMessages)
      .set({ parts: concurrentParts })
      .where(eq(assistantChatMessages.id, secondMessageId));
    const updatedAtSentinel = new Date("2030-01-01T00:00:00.000Z");
    await testDb
      .update(assistantChats)
      .set({ updatedAt: updatedAtSentinel })
      .where(eq(assistantChats.id, TEST_CHAT_ID));

    const committed = await commitChatMessagesIfLeaseOwned({
      lease,
      replacements: [
        {
          expectedParts: [...expectedParts],
          messageId: TEST_MESSAGE_ID,
          replacementParts: [...replacementParts],
        },
        {
          expectedParts: [...expectedParts],
          messageId: secondMessageId,
          replacementParts: [...replacementParts],
        },
      ],
      upsertMessage: {
        id: "user-atomic-commit",
        parts: [{ text: "must roll back", type: "text" }],
        role: "user",
      },
    });

    expect(committed).toBeNull();
    expect(await storedMessageParts(TEST_MESSAGE_ID)).toEqual(expectedParts);
    expect(await storedMessageParts(secondMessageId)).toEqual(concurrentParts);
    expect(await storedMessageParts("user-atomic-commit")).toBeUndefined();
    const [thread] = await testDb
      .select({ updatedAt: assistantChats.updatedAt })
      .from(assistantChats)
      .where(eq(assistantChats.id, TEST_CHAT_ID));
    expect(thread?.updatedAt).toEqual(updatedAtSentinel);
    expect(await releaseChatStreamLease(lease)).toBe(true);
  });

  it("never re-keys a message that collides with another conversation", async () => {
    const collisionId = "foreign-message-collision";
    const foreignParts = [{ text: "foreign secret", type: "text" as const }];
    await seedThread();
    await testDb.insert(assistantChats).values({
      id: "foreign-chat",
      namespace: "ns-test",
      title: "Foreign chat",
      workspaceActor: "other-user",
    });
    await testDb.insert(assistantChatMessages).values({
      chatId: "foreign-chat",
      id: collisionId,
      parts: foreignParts,
      role: "assistant",
    });

    const commitLease = await tryAcquireChatStreamLease({
      chatId: TEST_CHAT_ID,
      token: "lease-commit-collision",
    });
    if (commitLease == null) {
      throw new Error("expected the commit collision lease");
    }
    expect(
      await commitChatMessagesIfLeaseOwned({
        lease: commitLease,
        replacements: [],
        upsertMessage: {
          id: collisionId,
          parts: [{ text: "must not move", type: "text" }],
          role: "user",
        },
      })
    ).toBeNull();
    expect(await releaseChatStreamLease(commitLease)).toBe(true);

    const persistLease = await tryAcquireChatStreamLease({
      chatId: TEST_CHAT_ID,
      token: "lease-persist-collision",
    });
    if (persistLease == null) {
      throw new Error("expected the persist collision lease");
    }
    expect(
      await persistAssistantMessageIfLeaseOwned({
        lease: persistLease,
        message: {
          id: collisionId,
          parts: [{ text: "must not overwrite", type: "text" }],
          role: "assistant",
        },
      })
    ).toBe(false);

    const [foreignMessage] = await testDb
      .select({
        chatId: assistantChatMessages.chatId,
        parts: assistantChatMessages.parts,
        role: assistantChatMessages.role,
      })
      .from(assistantChatMessages)
      .where(eq(assistantChatMessages.id, collisionId));
    expect(foreignMessage).toEqual({
      chatId: "foreign-chat",
      parts: foreignParts,
      role: "assistant",
    });
    expect(await releaseChatStreamLease(persistLease)).toBe(true);
  });

  it("renews the lease for a full stream window during commit", async () => {
    await seedThread();
    const lease = await tryAcquireChatStreamLease({
      chatId: TEST_CHAT_ID,
      token: "lease-near-expiry",
      ttlMs: 10_000,
    });
    if (lease == null) {
      throw new Error("expected the near-expiry lease");
    }

    const renewed = await commitChatMessagesIfLeaseOwned({
      lease,
      replacements: [],
      upsertMessage: {
        id: "user-after-renewal",
        parts: [{ text: "start the stream", type: "text" }],
        role: "user",
      },
    });
    if (renewed == null) {
      throw new Error("expected the lease to renew during commit");
    }
    const leaseData = (renewed.parts[0] as { data?: unknown } | undefined)
      ?.data as { expiresAt?: unknown } | undefined;
    expect(typeof leaseData?.expiresAt).toBe("string");
    expect(
      Date.parse(String(leaseData?.expiresAt)) - Date.now()
    ).toBeGreaterThan(170_000);
    expect(await releaseChatStreamLease(lease)).toBe(false);
    expect(await releaseChatStreamLease(renewed)).toBe(true);
  });
});

const ACTOR_IDENTITY_REQUIRED_RE = /conversation actor identity is required/;

describe("adoptLegacyThreadsForActor", () => {
  // The nanoid crName and UUID userUid formats are disjoint (ADR-0059), so
  // the re-key matches only legacy rows and needs no version column.
  const LEGACY_CR_NAME = "hendrwa1";
  const USER_UID = "31b8a2f4-0f9f-4a3e-9c56-0d9f6f9e2b41";
  const UID_OWNER = { namespace: "ns-test", workspaceActor: USER_UID };
  const VERIFIED_ACTOR = {
    legacyWorkspaceActor: LEGACY_CR_NAME,
    owner: UID_OWNER,
  };

  function seedThreadRow(input: {
    id: string;
    namespace?: string;
    updatedAt: Date;
    workspaceActor: string;
  }) {
    return testDb.insert(assistantChats).values({
      id: input.id,
      namespace: input.namespace ?? "ns-test",
      title: `Title of ${input.id}`,
      updatedAt: input.updatedAt,
      workspaceActor: input.workspaceActor,
    });
  }

  async function allThreadRows() {
    const rows = await testDb.select().from(assistantChats);
    return rows.sort((a, b) => a.id.localeCompare(b.id));
  }

  it("keeps unadopted legacy rows invisible to uid reads, then adopts them on a verified entry", async () => {
    await seedThreadRow({
      id: "legacy-chat",
      updatedAt: new Date("2026-02-01T00:00:00.000Z"),
      workspaceActor: LEGACY_CR_NAME,
    });
    await testDb.insert(assistantChatMessages).values({
      chatId: "legacy-chat",
      id: "legacy-message",
      parts: [{ text: "beta-era content", type: "text" }],
      role: "assistant",
    });

    expect(
      await assistantConversationRepository.selectThreadsByOwner(UID_OWNER)
    ).toEqual([]);
    expect(
      await assistantConversationRepository.selectThreadByOwner(
        "legacy-chat",
        UID_OWNER
      )
    ).toBeNull();
    expect(
      await assistantConversationRepository.selectMessagesByOwner(
        UID_OWNER,
        "legacy-chat"
      )
    ).toBeNull();

    await assistantConversationRepository.adoptLegacyThreadsForActor(
      VERIFIED_ACTOR
    );

    const threads =
      await assistantConversationRepository.selectThreadsByOwner(UID_OWNER);
    expect(threads.map((thread) => thread.id)).toEqual(["legacy-chat"]);
    expect(
      await assistantConversationRepository.selectMessagesByOwner(
        UID_OWNER,
        "legacy-chat"
      )
    ).toEqual([
      {
        id: "legacy-message",
        parts: [{ text: "beta-era content", type: "text" }],
        role: "assistant",
      },
    ]);
  });

  it("is idempotent and preserves updatedAt so adoption never reorders the thread picker", async () => {
    await seedThreadRow({
      id: "older-chat",
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      workspaceActor: LEGACY_CR_NAME,
    });
    await seedThreadRow({
      id: "newer-chat",
      updatedAt: new Date("2026-03-01T00:00:00.000Z"),
      workspaceActor: LEGACY_CR_NAME,
    });

    await assistantConversationRepository.adoptLegacyThreadsForActor(
      VERIFIED_ACTOR
    );
    const adoptedRows = await allThreadRows();
    await assistantConversationRepository.adoptLegacyThreadsForActor(
      VERIFIED_ACTOR
    );

    expect(await allThreadRows()).toEqual(adoptedRows);
    expect(
      adoptedRows.map((row) => [row.workspaceActor, row.updatedAt])
    ).toEqual([
      [USER_UID, new Date("2026-03-01T00:00:00.000Z")],
      [USER_UID, new Date("2026-01-01T00:00:00.000Z")],
    ]);
  });

  it("re-keys only the actor's legacy rows in the actor's namespace", async () => {
    const foreignRows = [
      {
        id: "bob-legacy-chat",
        updatedAt: new Date("2026-02-01T00:00:00.000Z"),
        workspaceActor: "bobcrnm1",
      },
      {
        id: "carol-uid-chat",
        updatedAt: new Date("2026-02-02T00:00:00.000Z"),
        workspaceActor: "9d4a7e21-55c3-4b8f-8d2e-7a1f0c6b3e58",
      },
      {
        id: "cross-namespace-chat",
        namespace: "ns-other",
        updatedAt: new Date("2026-02-03T00:00:00.000Z"),
        workspaceActor: LEGACY_CR_NAME,
      },
    ];
    for (const row of foreignRows) {
      await seedThreadRow(row);
    }

    await assistantConversationRepository.adoptLegacyThreadsForActor(
      VERIFIED_ACTOR
    );

    expect(
      (await allThreadRows()).map((row) => [row.id, row.workspaceActor])
    ).toEqual([
      ["bob-legacy-chat", "bobcrnm1"],
      ["carol-uid-chat", "9d4a7e21-55c3-4b8f-8d2e-7a1f0c6b3e58"],
      ["cross-namespace-chat", LEGACY_CR_NAME],
    ]);
    expect(
      await assistantConversationRepository.selectThreadsByOwner(UID_OWNER)
    ).toEqual([]);
  });

  it("requires a verified actor identity", async () => {
    await expect(
      assistantConversationRepository.adoptLegacyThreadsForActor({
        legacyWorkspaceActor: "",
        owner: UID_OWNER,
      })
    ).rejects.toThrow(ACTOR_IDENTITY_REQUIRED_RE);
    await expect(
      assistantConversationRepository.adoptLegacyThreadsForActor({
        legacyWorkspaceActor: LEGACY_CR_NAME,
        owner: { namespace: "ns-test", workspaceActor: " " },
      })
    ).rejects.toThrow(ACTOR_IDENTITY_REQUIRED_RE);
  });
});
