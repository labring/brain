import { afterAll, test } from "bun:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import {
  assistantChatMessages,
  assistantChats,
  assistantEntitlements,
  githubAppInstallSessions,
  githubConnections,
  githubOauthConnections,
  identityFingerprints,
} from "@/features/chat/persistence/schema";

import { createIdentityFingerprintStore } from "./identity-fingerprint-core";

const assistantSchema = {
  assistantChatMessages,
  assistantChats,
  assistantEntitlements,
  githubAppInstallSessions,
  githubConnections,
  githubOauthConnections,
  identityFingerprints,
};

const pglite = new PGlite();
const db = drizzle(pglite, { schema: assistantSchema });
await migrate(db, {
  migrationsFolder: path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../drizzle"
  ),
});

const observe = createIdentityFingerprintStore(() => db);

afterAll(() => pglite.close());

function seedChat(input: {
  id: string;
  namespace: string;
  updatedAt?: Date;
  workspaceActor: string;
}) {
  return db.insert(assistantChats).values({
    id: input.id,
    namespace: input.namespace,
    title: `${input.id} title`,
    updatedAt: input.updatedAt ?? new Date("2026-07-01T00:00:00Z"),
    workspaceActor: input.workspaceActor,
  });
}

function seedConnection(input: {
  githubLogin: string;
  id: string;
  namespace: string;
  ownerIdentityVersion?: number;
  workspaceActor: string;
}) {
  return db.insert(githubOauthConnections).values({
    accessTokenCiphertext: `${input.id}-ciphertext`,
    githubLogin: input.githubLogin,
    id: input.id,
    namespace: input.namespace,
    ownerIdentityVersion: input.ownerIdentityVersion ?? 2,
    workspaceActor: input.workspaceActor,
  });
}

function selectFingerprint(crName: string) {
  return db
    .select({
      mintedAt: identityFingerprints.mintedAt,
      userUid: identityFingerprints.userUid,
    })
    .from(identityFingerprints)
    .where(eq(identityFingerprints.crName, crName))
    .then((rows) => rows[0] ?? null);
}

function selectChats(namespace: string) {
  return db
    .select({
      id: assistantChats.id,
      updatedAt: assistantChats.updatedAt,
      workspaceActor: assistantChats.workspaceActor,
    })
    .from(assistantChats)
    .where(eq(assistantChats.namespace, namespace))
    .orderBy(assistantChats.id);
}

function selectConnections(namespace: string) {
  return db
    .select({
      githubLogin: githubOauthConnections.githubLogin,
      id: githubOauthConnections.id,
      ownerIdentityVersion: githubOauthConnections.ownerIdentityVersion,
      workspaceActor: githubOauthConnections.workspaceActor,
    })
    .from(githubOauthConnections)
    .where(eq(githubOauthConnections.namespace, namespace))
    .orderBy(githubOauthConnections.id);
}

const POISONED_RE = /poisoned owner re-key/;
const OBSERVATION_REQUIRED_RE =
  /A verified identity binding observation is required\./;

test("a first observation records the binding and proceeds", async () => {
  assert.deepEqual(
    await observe({ crName: "first-cr", mintedAt: 1000, userUid: "first-uid" }),
    { outcome: "first_observation" }
  );
  assert.deepEqual(await selectFingerprint("first-cr"), {
    mintedAt: 1000,
    userUid: "first-uid",
  });
});

test("a matching binding proceeds and only a newer mint refreshes the fingerprint", async () => {
  await observe({ crName: "match-cr", mintedAt: 2000, userUid: "match-uid" });

  // An older matching token still agrees with the observation history.
  assert.deepEqual(
    await observe({ crName: "match-cr", mintedAt: 1500, userUid: "match-uid" }),
    { outcome: "match" }
  );
  assert.deepEqual(await selectFingerprint("match-cr"), {
    mintedAt: 2000,
    userUid: "match-uid",
  });

  assert.deepEqual(
    await observe({ crName: "match-cr", mintedAt: 2500, userUid: "match-uid" }),
    { outcome: "match" }
  );
  assert.deepEqual(await selectFingerprint("match-cr"), {
    mintedAt: 2500,
    userUid: "match-uid",
  });
});

test("a newer-minted contradiction re-keys both resource types and is idempotent", async () => {
  const preservedUpdatedAt = new Date("2026-06-15T12:00:00Z");
  await observe({
    crName: "merge-cr",
    mintedAt: 3000,
    userUid: "tombstone-uid",
  });
  await seedChat({
    id: "merge-chat-a",
    namespace: "merge-a",
    updatedAt: preservedUpdatedAt,
    workspaceActor: "tombstone-uid",
  });
  await seedChat({
    id: "merge-chat-b",
    namespace: "merge-b",
    workspaceActor: "tombstone-uid",
  });
  await seedChat({
    id: "merge-chat-carol",
    namespace: "merge-a",
    workspaceActor: "carol-uid",
  });
  await seedConnection({
    githubLogin: "tombstone-github",
    id: "merge-conn",
    namespace: "merge-a",
    workspaceActor: "tombstone-uid",
  });
  await seedConnection({
    githubLogin: "legacy-github",
    id: "merge-conn-legacy",
    namespace: "merge-a",
    ownerIdentityVersion: 1,
    workspaceActor: "merge-cr",
  });

  assert.deepEqual(
    await observe({
      crName: "merge-cr",
      mintedAt: 4000,
      userUid: "survivor-uid",
    }),
    { outcome: "merge" }
  );

  assert.deepEqual(await selectFingerprint("merge-cr"), {
    mintedAt: 4000,
    userUid: "survivor-uid",
  });
  // Both namespaces re-keyed on the same request; a merge never reorders the
  // thread picker, and a foreign owner is never touched.
  assert.deepEqual(await selectChats("merge-a"), [
    {
      id: "merge-chat-a",
      updatedAt: preservedUpdatedAt,
      workspaceActor: "survivor-uid",
    },
    {
      id: "merge-chat-carol",
      updatedAt: new Date("2026-07-01T00:00:00Z"),
      workspaceActor: "carol-uid",
    },
  ]);
  assert.deepEqual(
    (await selectChats("merge-b")).map((row) => row.workspaceActor),
    ["survivor-uid"]
  );
  // The uid-keyed connection follows the survivor; the crName-keyed legacy
  // row stays for the existing lazy adoption path.
  assert.deepEqual(await selectConnections("merge-a"), [
    {
      githubLogin: "tombstone-github",
      id: "merge-conn",
      ownerIdentityVersion: 2,
      workspaceActor: "survivor-uid",
    },
    {
      githubLogin: "legacy-github",
      id: "merge-conn-legacy",
      ownerIdentityVersion: 1,
      workspaceActor: "merge-cr",
    },
  ]);

  // Replaying the same newer token is a plain match and changes nothing.
  assert.deepEqual(
    await observe({
      crName: "merge-cr",
      mintedAt: 4000,
      userUid: "survivor-uid",
    }),
    { outcome: "match" }
  );
  assert.deepEqual(await selectFingerprint("merge-cr"), {
    mintedAt: 4000,
    userUid: "survivor-uid",
  });
});

test("where the survivor already reauthorized, that connection wins and the tombstone's is released", async () => {
  await observe({ crName: "winner-cr", mintedAt: 5000, userUid: "loser-uid" });
  await seedConnection({
    githubLogin: "survivor-github",
    id: "winner-conn-survivor",
    namespace: "winner-a",
    workspaceActor: "winner-uid",
  });
  await seedConnection({
    githubLogin: "tombstone-github",
    id: "winner-conn-tombstone",
    namespace: "winner-a",
    workspaceActor: "loser-uid",
  });
  await seedConnection({
    githubLogin: "tombstone-github",
    id: "winner-conn-moved",
    namespace: "winner-b",
    workspaceActor: "loser-uid",
  });

  assert.deepEqual(
    await observe({
      crName: "winner-cr",
      mintedAt: 6000,
      userUid: "winner-uid",
    }),
    { outcome: "merge" }
  );

  assert.deepEqual(await selectConnections("winner-a"), [
    {
      githubLogin: "survivor-github",
      id: "winner-conn-survivor",
      ownerIdentityVersion: 2,
      workspaceActor: "winner-uid",
    },
  ]);
  assert.deepEqual(await selectConnections("winner-b"), [
    {
      githubLogin: "tombstone-github",
      id: "winner-conn-moved",
      ownerIdentityVersion: 2,
      workspaceActor: "winner-uid",
    },
  ]);
});

test("an older or equal-minted contradiction is superseded and mutates nothing", async () => {
  await observe({ crName: "stale-cr", mintedAt: 7000, userUid: "current-uid" });
  await seedChat({
    id: "stale-chat",
    namespace: "stale",
    workspaceActor: "current-uid",
  });
  await seedConnection({
    githubLogin: "current-github",
    id: "stale-conn",
    namespace: "stale",
    workspaceActor: "current-uid",
  });

  assert.deepEqual(
    await observe({
      crName: "stale-cr",
      mintedAt: 6500,
      userUid: "replayed-uid",
    }),
    {
      observedMintedAt: 7000,
      observedUserUid: "current-uid",
      outcome: "superseded",
    }
  );
  assert.deepEqual(
    await observe({
      crName: "stale-cr",
      mintedAt: 7000,
      userUid: "replayed-uid",
    }),
    {
      observedMintedAt: 7000,
      observedUserUid: "current-uid",
      outcome: "superseded",
    }
  );

  assert.deepEqual(await selectFingerprint("stale-cr"), {
    mintedAt: 7000,
    userUid: "current-uid",
  });
  assert.deepEqual(
    (await selectChats("stale")).map((row) => row.workspaceActor),
    ["current-uid"]
  );
  assert.deepEqual(
    (await selectConnections("stale")).map((row) => row.workspaceActor),
    ["current-uid"]
  );

  // A subsequently re-minted current token matches and works again.
  assert.deepEqual(
    await observe({
      crName: "stale-cr",
      mintedAt: 8000,
      userUid: "current-uid",
    }),
    { outcome: "match" }
  );
});

test("a mid-merge failure rolls back the fingerprint and every re-key", async () => {
  await observe({ crName: "atomic-cr", mintedAt: 9000, userUid: "atomic-old" });
  await seedChat({
    id: "atomic-chat",
    namespace: "atomic",
    workspaceActor: "atomic-old",
  });
  await seedConnection({
    githubLogin: "atomic-github",
    id: "atomic-conn",
    namespace: "atomic",
    workspaceActor: "atomic-old",
  });
  // The connection re-key runs after the fingerprint and conversation
  // updates, so failing it must roll the whole merge back.
  await pglite.exec(`
    CREATE FUNCTION reject_poisoned_owner() RETURNS trigger AS $$
    BEGIN
      IF NEW.workspace_actor = 'atomic-new' THEN
        RAISE EXCEPTION 'poisoned owner re-key';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER reject_poisoned_owner_trigger
      BEFORE UPDATE ON sealai_assistant.github_oauth_connections
      FOR EACH ROW EXECUTE FUNCTION reject_poisoned_owner();
  `);

  try {
    await assert.rejects(
      observe({ crName: "atomic-cr", mintedAt: 10_000, userUid: "atomic-new" }),
      POISONED_RE
    );
  } finally {
    await pglite.exec(`
      DROP TRIGGER reject_poisoned_owner_trigger
        ON sealai_assistant.github_oauth_connections;
      DROP FUNCTION reject_poisoned_owner();
    `);
  }

  assert.deepEqual(await selectFingerprint("atomic-cr"), {
    mintedAt: 9000,
    userUid: "atomic-old",
  });
  assert.deepEqual(
    (await selectChats("atomic")).map((row) => row.workspaceActor),
    ["atomic-old"]
  );
  assert.deepEqual(
    (await selectConnections("atomic")).map((row) => row.workspaceActor),
    ["atomic-old"]
  );
});

test("an unobservable binding is refused before any read or write", async () => {
  await assert.rejects(
    observe({ crName: " ", mintedAt: 1, userUid: "uid" }),
    OBSERVATION_REQUIRED_RE
  );
  await assert.rejects(
    observe({ crName: "cr", mintedAt: 1, userUid: "" }),
    OBSERVATION_REQUIRED_RE
  );
  await assert.rejects(
    observe({ crName: "cr", mintedAt: Number.NaN, userUid: "uid" }),
    OBSERVATION_REQUIRED_RE
  );
  await assert.rejects(
    observe({ crName: "cr", mintedAt: 1.5, userUid: "uid" }),
    OBSERVATION_REQUIRED_RE
  );
  await assert.rejects(
    observe({ crName: "cr", mintedAt: -1, userUid: "uid" }),
    OBSERVATION_REQUIRED_RE
  );
});
