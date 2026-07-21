import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
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
} from "./schema";

const assistantSchema = {
  assistantChatMessages,
  assistantChats,
  assistantEntitlements,
  githubAppInstallSessions,
  githubConnections,
  githubOauthConnections,
};
const pglite = new PGlite();
const db = drizzle(pglite, { schema: assistantSchema });

after(() => pglite.close());

test("repository never exposes or mutates a foreign conversation, including on message-id collision", async () => {
  const migrationsFolder = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../drizzle"
  );
  await migrate(db, { migrationsFolder });
  const repository = createAssistantConversationRepository(() => db);
  const alice = { namespace: "shared", workspaceActor: "alice-cr" };
  const bob = { namespace: "shared", workspaceActor: "bob-cr" };

  assert.equal(
    await repository.ensureThreadForOwner({
      id: "bob-chat",
      owner: bob,
      title: "Bob title",
    }),
    true
  );
  assert.equal(
    await repository.upsertMessageForOwner(bob, "bob-chat", {
      id: "shared-message-id",
      role: "assistant",
      parts: [{ type: "text", text: "Bob secret" }],
    }),
    true
  );
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
    await repository.upsertMessageForOwner(alice, "bob-chat", {
      id: "attacker-message",
      role: "user",
      parts: [{ type: "text", text: "overwrite foreign chat" }],
    }),
    false
  );
  assert.equal(
    await repository.upsertMessageForOwner(alice, "alice-chat", {
      id: "shared-message-id",
      role: "user",
      parts: [{ type: "text", text: "overwrite colliding message" }],
    }),
    false
  );
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
