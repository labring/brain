import { afterAll, test } from "bun:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { SignJWT } from "jose";

import {
  assistantChatMessages,
  assistantChats,
  assistantDevboxRuntimes,
  assistantEntitlements,
  githubAppInstallSessions,
  githubConnections,
  githubOauthConnections,
  identityFingerprints,
} from "@/features/chat/persistence/schema";
import { createIdentityFingerprintStore } from "@/lib/identity-fingerprint-core";

import { createNotificationHandlers } from "./http-handlers";
import { notificationMessages, notificationReadReceipts } from "./schema";
import { createNotificationStore } from "./store";
import { notificationFeedResponseSchema } from "./types";

const pglite = new PGlite();
// The fingerprint store wants the assistant schema; the notification store
// only its own three tables — one PGlite handle with both keeps them in the
// same database, as production does.
const db = drizzle(pglite, {
  schema: {
    assistantChatMessages,
    assistantChats,
    assistantDevboxRuntimes,
    assistantEntitlements,
    githubAppInstallSessions,
    githubConnections,
    githubOauthConnections,
    identityFingerprints,
    notificationMessages,
    notificationReadReceipts,
  },
});
await migrate(db, {
  migrationsFolder: path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../drizzle"
  ),
});

const store = createNotificationStore(() => db);
const observeFingerprint = createIdentityFingerprintStore(() => db);

afterAll(() => pglite.close());

const APP_TOKEN_SECRET = "cluster-shared-jwt-internal";
const APP_TOKEN_CONFIG = { secret: APP_TOKEN_SECRET };

function mintAppToken(crName: string) {
  return new SignJWT({ userCrName: crName, userUid: `${crName}-uid` })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(1_753_600_000)
    .sign(new TextEncoder().encode(APP_TOKEN_SECRET));
}

function jwt(subject: string): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", typ: "JWT" })
  ).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub: subject })).toString(
    "base64url"
  );
  return `${header}.${payload}.test-signature`;
}

function encodedKubeconfig(namespace: string, workspaceActor: string): string {
  return encodeURIComponent(`
apiVersion: v1
clusters:
  - name: cluster
    cluster:
      server: https://example.test
contexts:
  - name: current
    context:
      cluster: cluster
      namespace: ${namespace}
      user: active-user
current-context: current
users:
  - name: active-user
    user:
      token: ${jwt(`system:serviceaccount:user-system:${workspaceActor}`)}
`);
}

async function request(
  pathname: string,
  options: {
    actor: string;
    appToken?: string | null;
    body?: unknown;
    namespace?: string;
  }
): Promise<Request> {
  const namespace = options.namespace ?? "ns-a";
  return new Request(
    `https://brain.test/api/notifications${pathname}?namespace=${namespace}`,
    {
      body: options.body == null ? undefined : JSON.stringify(options.body),
      headers: {
        Authorization: `Bearer ${encodedKubeconfig(namespace, options.actor)}`,
        "content-type": "application/json",
        ...(options.appToken === null
          ? {}
          : {
              "X-Sealos-App-Token":
                options.appToken ?? (await mintAppToken(options.actor)),
            }),
      },
      method: options.body == null ? "GET" : "POST",
    }
  );
}

const handlers = createNotificationHandlers({
  appTokenConfig: APP_TOKEN_CONFIG,
  observeFingerprint,
  store,
  verify: () => Promise.resolve({ ok: true }),
});

test("a quota observation crossing 100% writes one entry, and the feed lists it unread", async () => {
  const full = {
    quota: {
      items: [
        { limit: 20_480, type: "storage", used: 20_480 },
        { limit: 4000, type: "cpu", used: 1000 },
      ],
    },
  };

  const first = await handlers.observeQuota(
    await request("/quota-observation", { actor: "alice", body: full })
  );
  const retry = await handlers.observeQuota(
    await request("/quota-observation", { actor: "alice", body: full })
  );
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { produced: ["storage"], released: [] });
  assert.deepEqual(await retry.json(), { produced: [], released: [] });

  const feed = await handlers.feed(await request("", { actor: "alice" }));
  assert.equal(feed.status, 200);
  const parsed = notificationFeedResponseSchema.parse(await feed.json());
  assert.equal(parsed.messages.length, 1);
  assert.deepEqual(parsed.messages[0]?.payload, {
    kind: "quota-exhausted",
    limit: 20_480,
    resource: "storage",
    used: 20_480,
  });
  assert.deepEqual(parsed.receipts, []);
});

test("marking read writes a receipt the feed returns; other users keep theirs empty", async () => {
  const feed = notificationFeedResponseSchema.parse(
    await (await handlers.feed(await request("", { actor: "alice" }))).json()
  );
  const dbId = `db:${feed.messages[0]?.id}`;

  const marked = await handlers.markRead(
    await request("/read", {
      actor: "alice",
      body: { ids: [dbId, "cr:debt-choice-debtperiod:1756200000"] },
    })
  );
  assert.equal(marked.status, 200);

  const alice = notificationFeedResponseSchema.parse(
    await (await handlers.feed(await request("", { actor: "alice" }))).json()
  );
  assert.deepEqual(
    [...alice.receipts].sort(),
    [dbId, "cr:debt-choice-debtperiod:1756200000"].sort()
  );

  const bob = notificationFeedResponseSchema.parse(
    await (await handlers.feed(await request("", { actor: "bob" }))).json()
  );
  assert.equal(bob.messages.length, 1, "the workspace stream is shared");
  assert.deepEqual(bob.receipts, [], "read state is personal");
});

test("the stream is scoped to the verified workspace; receipts follow the person", async () => {
  const other = notificationFeedResponseSchema.parse(
    await (
      await handlers.feed(
        await request("", { actor: "alice", namespace: "ns-b" })
      )
    ).json()
  );
  assert.deepEqual(other.messages, []);
  assert.ok(
    other.receipts.includes("cr:debt-choice-debtperiod:1756200000"),
    "an account-level CR read in one workspace is read in every workspace"
  );
});

test("requests without an App Token are refused; malformed bodies answer 400", async () => {
  const noToken = await handlers.feed(
    await request("", { actor: "alice", appToken: null })
  );
  assert.equal(noToken.status, 401);

  const badRead = await handlers.markRead(
    await request("/read", { actor: "alice", body: { ids: ["n1"] } })
  );
  assert.equal(badRead.status, 400);

  const badQuota = await handlers.observeQuota(
    await request("/quota-observation", { actor: "alice", body: { quota: {} } })
  );
  assert.equal(badQuota.status, 400);
});

test("a visible gift writes one hint per user through the route; a retry writes nothing", async () => {
  const body = { giftMicroUnits: 720_000 };
  const first = await handlers.observeGift(
    await request("/gift-observation", { actor: "carol", body })
  );
  const retry = await handlers.observeGift(
    await request("/gift-observation", { actor: "carol", body })
  );
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { produced: true });
  assert.deepEqual(await retry.json(), { produced: false });

  const feed = notificationFeedResponseSchema.parse(
    await (await handlers.feed(await request("", { actor: "carol" }))).json()
  );
  const hint = feed.messages.find((message) => message.kind === "credit-hint");
  assert.deepEqual(hint?.payload, {
    giftMicroUnits: 720_000,
    kind: "credit-hint",
  });

  const bad = await handlers.observeGift(
    await request("/gift-observation", {
      actor: "carol",
      body: { giftMicroUnits: -1 },
    })
  );
  assert.equal(bad.status, 400);
});

test("a subscription change writes one receipt per transaction through the route", async () => {
  const body = {
    change: "upgraded",
    planName: "Pro",
    transactionId: "txn-route-1",
  };
  const first = await handlers.observeSubscriptionChange(
    await request("/subscription-change", { actor: "carol", body })
  );
  const again = await handlers.observeSubscriptionChange(
    await request("/subscription-change", { actor: "carol", body })
  );
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { produced: true });
  assert.deepEqual(await again.json(), { produced: false });

  const feed = notificationFeedResponseSchema.parse(
    await (await handlers.feed(await request("", { actor: "carol" }))).json()
  );
  const receipt = feed.messages.find(
    (message) => message.kind === "subscription-change"
  );
  assert.deepEqual(receipt?.payload, {
    change: "upgraded",
    kind: "subscription-change",
    planName: "Pro",
  });

  const bad = await handlers.observeSubscriptionChange(
    await request("/subscription-change", {
      actor: "carol",
      body: { change: "renewed", planName: "Pro", transactionId: "t" },
    })
  );
  assert.equal(bad.status, 400);
});
