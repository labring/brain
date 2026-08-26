import { afterAll, mock, test } from "bun:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import type { AssistantPgTransaction } from "@/features/chat/persistence/db";
import {
  githubOauthConnections,
  identityFingerprints,
} from "@/features/chat/persistence/schema";
import { IdentityBindingSupersededError } from "@/lib/identity-fingerprint-core";

process.env.GITHUB_USER_TOKEN_ENCRYPTION_KEY = "connection-service-test-key";

const MIGRATIONS_FOLDER = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../drizzle"
);

const pglite = new PGlite();
const testDb = drizzle(pglite, { schema: { githubOauthConnections } });

mock.module("server-only", () => ({}));
mock.module("@/features/chat/persistence/db", () => ({
  getAssistantDb: () => testDb,
}));

await migrate(testDb, { migrationsFolder: MIGRATIONS_FOLDER });

// Adoption re-checks the fingerprint in its own transaction (ADR-0059), so
// every verified actor these tests use needs an observed binding.
await testDb.insert(identityFingerprints).values([
  { crName: "alice-cr", mintedAt: 1000, userUid: "alice-uid" },
  { crName: "bob-cr", mintedAt: 1000, userUid: "bob-uid" },
  { crName: "dave-cr", mintedAt: 1000, userUid: "dave-uid" },
]);

const {
  adoptLegacyGithubConnectionForOwner,
  beginGithubConnectionRevocationForActor,
  getGithubConnectionStatusForOwner,
  revokeGithubConnectionsForActor,
  upsertGithubOauthConnectionInTransaction,
} = await import("./connection-service");

afterAll(() => pglite.close());

const TEST_TOKEN = {
  accessToken: "gho_test-token",
  scope: "repo,write:packages",
  tokenType: "bearer",
} as const;

const CURRENT_OWNER_INDEX_PREDICATE_RE = /owner_identity_version\s*=\s*2/;
const CURRENT_OWNER_UNIQUE_INDEX_RE =
  /github_oauth_connections_current_owner_unique_idx/;
const CURRENT_OWNER_IDENTITY_REQUIRED_RE =
  /Current GitHub connection owner identity is required\./;

function owner(userUid: string, namespace = "shared") {
  return { namespace, ownerIdentityVersion: 2, userUid };
}

function insertLegacyConnection(input: {
  githubLogin: string;
  id: string;
  namespace?: string;
  workspaceActor: string;
}) {
  return testDb.insert(githubOauthConnections).values({
    accessTokenCiphertext: "legacy-ciphertext",
    githubLogin: input.githubLogin,
    id: input.id,
    namespace: input.namespace ?? "shared",
    ownerIdentityVersion: 1,
    updatedAt: new Date(),
    workspaceActor: input.workspaceActor,
  });
}

function upsertConnection(input: {
  githubLogin: string;
  namespace?: string;
  userUid: string;
}) {
  return testDb.transaction((tx) =>
    upsertGithubOauthConnectionInTransaction(
      tx as unknown as AssistantPgTransaction,
      {
        githubLogin: input.githubLogin,
        owner: owner(input.userUid, input.namespace),
        token: TEST_TOKEN,
      }
    )
  );
}

function selectRows(namespace: string) {
  return testDb
    .select({
      githubLogin: githubOauthConnections.githubLogin,
      ownerIdentityVersion: githubOauthConnections.ownerIdentityVersion,
      workspaceActor: githubOauthConnections.workspaceActor,
    })
    .from(githubOauthConnections)
    .where(eq(githubOauthConnections.namespace, namespace))
    .orderBy(githubOauthConnections.workspaceActor);
}

test("migration 0008 replays on the previous journal state and re-keys the unique index to generation 2", async () => {
  const legacyDb = new PGlite();
  const applyMigration = async (name: string) => {
    const sql = await readFile(path.join(MIGRATIONS_FOLDER, name), "utf8");
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
      "0006_bind_verified_workspace_actors.sql",
      "0007_case_insensitive_project_display_names.sql",
    ]) {
      await applyMigration(name);
    }
    await legacyDb.exec(`
      INSERT INTO sealai_assistant.github_oauth_connections
        (id, namespace, workspace_actor, owner_identity_version,
         github_login, access_token_ciphertext)
      VALUES ('legacy-alice', 'shared', 'alice-cr', 1,
              'alice-github', 'legacy-ciphertext');
    `);

    await applyMigration("0008_github_owner_identity_generation_2.sql");

    const survivors = await legacyDb.query<{
      owner_identity_version: number;
      workspace_actor: string;
    }>(`
      SELECT workspace_actor, owner_identity_version
      FROM sealai_assistant.github_oauth_connections
    `);
    assert.deepEqual(survivors.rows, [
      { owner_identity_version: 1, workspace_actor: "alice-cr" },
    ]);

    const index = await legacyDb.query<{ indexdef: string }>(`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'sealai_assistant'
        AND indexname = 'github_oauth_connections_current_owner_unique_idx'
    `);
    assert.equal(index.rows.length, 1);
    assert.match(
      index.rows[0]?.indexdef ?? "",
      CURRENT_OWNER_INDEX_PREDICATE_RE
    );

    await legacyDb.exec(`
      INSERT INTO sealai_assistant.github_oauth_connections
        (id, namespace, workspace_actor, owner_identity_version,
         github_login, access_token_ciphertext)
      VALUES ('current-alice', 'shared', 'alice-uid', 2,
              'alice-github', 'current-ciphertext');
    `);
    await assert.rejects(
      legacyDb.exec(`
        INSERT INTO sealai_assistant.github_oauth_connections
          (id, namespace, workspace_actor, owner_identity_version,
           github_login, access_token_ciphertext)
        VALUES ('current-alice-duplicate', 'shared', 'alice-uid', 2,
                'alice-github', 'duplicate-ciphertext');
      `),
      CURRENT_OWNER_UNIQUE_INDEX_RE
    );
  } finally {
    await legacyDb.close();
  }
});

test("adoption re-keys the legacy crName row to the uid and generation 2 in one idempotent update", async () => {
  await insertLegacyConnection({
    githubLogin: "alice-github",
    id: "adopt-alice",
    namespace: "adopt",
    workspaceActor: "alice-cr",
  });

  assert.equal(
    await getGithubConnectionStatusForOwner(owner("alice-uid", "adopt")),
    null
  );

  await adoptLegacyGithubConnectionForOwner({
    legacyWorkspaceActor: "alice-cr",
    owner: owner("alice-uid", "adopt"),
  });
  await adoptLegacyGithubConnectionForOwner({
    legacyWorkspaceActor: "alice-cr",
    owner: owner("alice-uid", "adopt"),
  });

  assert.deepEqual(await selectRows("adopt"), [
    {
      githubLogin: "alice-github",
      ownerIdentityVersion: 2,
      workspaceActor: "alice-uid",
    },
  ]);
  const status = await getGithubConnectionStatusForOwner(
    owner("alice-uid", "adopt")
  );
  assert.equal(status?.accountLogin, "alice-github");
});

test("adopting after reauthorization hits the unique index and the new authorization wins", async () => {
  await insertLegacyConnection({
    githubLogin: "legacy-github",
    id: "conflict-legacy",
    namespace: "conflict",
    workspaceActor: "alice-cr",
  });
  await upsertConnection({
    githubLogin: "reauthorized-github",
    namespace: "conflict",
    userUid: "alice-uid",
  });

  await adoptLegacyGithubConnectionForOwner({
    legacyWorkspaceActor: "alice-cr",
    owner: owner("alice-uid", "conflict"),
  });

  assert.deepEqual(await selectRows("conflict"), [
    {
      githubLogin: "legacy-github",
      ownerIdentityVersion: 1,
      workspaceActor: "alice-cr",
    },
    {
      githubLogin: "reauthorized-github",
      ownerIdentityVersion: 2,
      workspaceActor: "alice-uid",
    },
  ]);
  const status = await getGithubConnectionStatusForOwner(
    owner("alice-uid", "conflict")
  );
  assert.equal(status?.accountLogin, "reauthorized-github");
});

test("reauthorization converges on one active generation-2 connection per owner", async () => {
  const first = await upsertConnection({
    githubLogin: "first-github",
    namespace: "converge",
    userUid: "alice-uid",
  });
  const second = await upsertConnection({
    githubLogin: "second-github",
    namespace: "converge",
    userUid: "alice-uid",
  });

  assert.equal(second.id, first.id);
  assert.deepEqual(await selectRows("converge"), [
    {
      githubLogin: "second-github",
      ownerIdentityVersion: 2,
      workspaceActor: "alice-uid",
    },
  ]);
});

test("another member never sees, adopts, or revokes a foreign connection", async () => {
  await insertLegacyConnection({
    githubLogin: "alice-github",
    id: "foreign-legacy",
    namespace: "foreign",
    workspaceActor: "alice-cr",
  });
  await upsertConnection({
    githubLogin: "carol-github",
    namespace: "foreign",
    userUid: "carol-uid",
  });

  await adoptLegacyGithubConnectionForOwner({
    legacyWorkspaceActor: "bob-cr",
    owner: owner("bob-uid", "foreign"),
  });
  assert.equal(
    await getGithubConnectionStatusForOwner(owner("bob-uid", "foreign")),
    null
  );

  await revokeGithubConnectionsForActor({
    legacyWorkspaceActor: "bob-cr",
    owner: owner("bob-uid", "foreign"),
  });
  assert.deepEqual(await selectRows("foreign"), [
    {
      githubLogin: "alice-github",
      ownerIdentityVersion: 1,
      workspaceActor: "alice-cr",
    },
    {
      githubLogin: "carol-github",
      ownerIdentityVersion: 2,
      workspaceActor: "carol-uid",
    },
  ]);
});

test("disconnect forgets both generations so the inert legacy row cannot resurrect", async () => {
  await insertLegacyConnection({
    githubLogin: "legacy-github",
    id: "forget-legacy",
    namespace: "forget",
    workspaceActor: "alice-cr",
  });
  await upsertConnection({
    githubLogin: "reauthorized-github",
    namespace: "forget",
    userUid: "alice-uid",
  });

  await revokeGithubConnectionsForActor({
    legacyWorkspaceActor: "alice-cr",
    owner: owner("alice-uid", "forget"),
  });

  assert.deepEqual(await selectRows("forget"), []);

  // A later verified entry has nothing to adopt and sees no connection.
  await adoptLegacyGithubConnectionForOwner({
    legacyWorkspaceActor: "alice-cr",
    owner: owner("alice-uid", "forget"),
  });
  assert.equal(
    await getGithubConnectionStatusForOwner(owner("alice-uid", "forget")),
    null
  );
});

test("revocation fences reads and does not delete a reauthorization created during cleanup", async () => {
  await upsertConnection({
    githubLogin: "before-revoke",
    namespace: "revocation-race",
    userUid: "alice-uid",
  });

  const actor = {
    legacyWorkspaceActor: "alice-cr",
    owner: owner("alice-uid", "revocation-race"),
  };
  const fence = await beginGithubConnectionRevocationForActor(actor);
  assert.equal(
    await getGithubConnectionStatusForOwner(
      owner("alice-uid", "revocation-race")
    ),
    null
  );

  await upsertConnection({
    githubLogin: "after-revoke",
    namespace: "revocation-race",
    userUid: "alice-uid",
  });
  await revokeGithubConnectionsForActor(actor, fence);

  const status = await getGithubConnectionStatusForOwner(
    owner("alice-uid", "revocation-race")
  );
  assert.equal(status?.accountLogin, "after-revoke");
});

test("a retrying disconnect fences a reauthorization left behind by a failed cleanup", async () => {
  await upsertConnection({
    githubLogin: "before-failed-cleanup",
    namespace: "revocation-retry",
    userUid: "alice-uid",
  });
  const actor = {
    legacyWorkspaceActor: "alice-cr",
    owner: owner("alice-uid", "revocation-retry"),
  };

  // The first DELETE fenced the old credential, but runtime cleanup failed,
  // so the fenced row remains while the user authorizes again.
  await beginGithubConnectionRevocationForActor(actor);
  await upsertConnection({
    githubLogin: "after-failed-cleanup",
    namespace: "revocation-retry",
    userUid: "alice-uid",
  });

  // A second DELETE must fence the new active row as well, then remove both
  // fenced generations after cleanup succeeds.
  const retryFence = await beginGithubConnectionRevocationForActor(actor);
  await revokeGithubConnectionsForActor(actor, retryFence);

  assert.equal(
    await getGithubConnectionStatusForOwner(
      owner("alice-uid", "revocation-retry")
    ),
    null
  );
  assert.deepEqual(await selectRows("revocation-retry"), []);
});

test("adoption refuses a uid tombstoned by a merge, keeping the legacy row adoptable", async () => {
  await insertLegacyConnection({
    githubLogin: "dave-github",
    id: "tombstone-legacy",
    namespace: "tombstone",
    workspaceActor: "dave-cr",
  });
  await testDb
    .update(identityFingerprints)
    .set({ userUid: "dave-survivor-uid" })
    .where(eq(identityFingerprints.crName, "dave-cr"));

  await assert.rejects(
    adoptLegacyGithubConnectionForOwner({
      legacyWorkspaceActor: "dave-cr",
      owner: owner("dave-uid", "tombstone"),
    }),
    IdentityBindingSupersededError
  );

  // The legacy row stays crName-keyed, so the survivor still adopts it.
  await adoptLegacyGithubConnectionForOwner({
    legacyWorkspaceActor: "dave-cr",
    owner: owner("dave-survivor-uid", "tombstone"),
  });
  assert.deepEqual(await selectRows("tombstone"), [
    {
      githubLogin: "dave-github",
      ownerIdentityVersion: 2,
      workspaceActor: "dave-survivor-uid",
    },
  ]);
});

test("adoption requires the current generation owner identity", async () => {
  await assert.rejects(
    adoptLegacyGithubConnectionForOwner({
      legacyWorkspaceActor: "alice-cr",
      owner: { namespace: "adopt", ownerIdentityVersion: 1, userUid: "uid" },
    }),
    CURRENT_OWNER_IDENTITY_REQUIRED_RE
  );
  await assert.rejects(
    adoptLegacyGithubConnectionForOwner({
      legacyWorkspaceActor: "",
      owner: owner("alice-uid", "adopt"),
    }),
    CURRENT_OWNER_IDENTITY_REQUIRED_RE
  );
});
