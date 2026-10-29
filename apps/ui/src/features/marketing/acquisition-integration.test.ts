import { afterAll, afterEach, beforeAll, mock, test } from "bun:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { SignJWT } from "jose";
import { createDeployTaskTestHarness } from "@/features/deploy/task/engine/testing/harness";
import type { WorkspaceActorAuthorization } from "@/lib/request-kubeconfig-auth";
import type { MarketingPgDatabase } from "./db";
import {
  marketingAttributionSubjects,
  marketingLifecycleEvents,
} from "./schema";

mock.module("server-only", () => ({}));
const { acquisitionClientConfig, fetchAccountAcquisition } = await import(
  "./acquisition-client"
);
const { createAcquisitionSyncHandler } = await import("./acquisition-handler");
const { syncAccountAcquisition } = await import("./acquisition-service");
const { publishMarketingLifecycleBatch } = await import(
  "./lifecycle-publisher"
);
const KEY = "brain-acquisition-receipt-test-key";
const CONFIG = {
  baseUrl: "https://authority.example.test",
  secret: "server-test-secret",
};
const UID = "brain-acquisition-user";
const previousKey = process.env.MARKETING_CONSENT_SIGNING_KEY;
const harness = await createDeployTaskTestHarness();
const getDb = () => harness.db as unknown as MarketingPgDatabase;
const touch = {
  campaign: "app-launch",
  channel: "paid_search",
  click_id_type: "gclid",
  click_id_value: "consented-click",
  source: "google",
  ts: "2026-10-29T00:00:00Z",
};
const RAW = Buffer.from(
  JSON.stringify({ version: 2, first_touch: touch, last_touch: touch })
).toString("base64url");

beforeAll(() => {
  process.env.MARKETING_CONSENT_SIGNING_KEY = KEY;
});
afterEach(async () => {
  await harness.db.delete(marketingLifecycleEvents);
  await harness.db.delete(marketingAttributionSubjects);
});
afterAll(async () => {
  if (previousKey === undefined) {
    delete process.env.MARKETING_CONSENT_SIGNING_KEY;
  } else {
    process.env.MARKETING_CONSENT_SIGNING_KEY = previousKey;
  }
  await harness.close();
});

async function response(
  overrides: Record<string, unknown> = {},
  granted = false
) {
  const token = await new SignJWT({
    ad_personalization: granted ? "granted" : "unspecified",
    ad_user_data_consent: granted ? "granted" : "unspecified",
    attribution_hash: createHash("sha256").update(RAW).digest("hex"),
    consent_source: "desktop_oauth",
    region: "global",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("sealos-desktop")
    .setAudience("brain-marketing-attribution")
    .setSubject(UID)
    .setJti("acquisition-link")
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(new TextEncoder().encode(KEY));
  return Response.json({
    version: 1,
    subject_id: UID,
    realm: "global",
    sea_attr: RAW,
    consent_token: token,
    consent: {
      analytics_storage: "granted",
      ad_storage: "unspecified",
      ad_user_data: "unspecified",
      ad_personalization: "unspecified",
    },
    linked_at: "2026-10-29T01:00:00Z",
    ...overrides,
  });
}
const ACTOR = {
  actorBinding: {
    crName: "acquisition-cr",
    mintedAt: 123,
    userId: "account-id",
    userUid: UID,
  },
  namespace: "workspace-a",
  ok: true,
  workspaceActor: "acquisition-cr",
} satisfies WorkspaceActorAuthorization;
const request = () =>
  new Request(
    "https://brain.example.test/api/marketing/acquisition?namespace=workspace-a",
    {
      method: "POST",
      body: JSON.stringify({ subject_id: "forged-user" }),
      headers: { "Content-Type": "application/json" },
    }
  );

test("authenticated bootstrap persists the account source before any deployment, ignoring claimed UID", async () => {
  let requestedUid = "";
  const lookup: typeof fetchAccountAcquisition = (uid) => {
    requestedUid = uid;
    return fetchAccountAcquisition(uid, {
      config: CONFIG,
      fetch: (url, init) => {
        assert.equal(new URL(String(url)).searchParams.get("subject_id"), UID);
        assert.equal(
          new Headers(init?.headers).get("authorization"),
          `Bearer ${CONFIG.secret}`
        );
        assert.equal(init?.redirect, "error");
        return response();
      },
    });
  };
  const handler = createAcquisitionSyncHandler({
    authorize: async () => ({ ok: true, authorization: ACTOR }),
    sync: (uid) => syncAccountAcquisition(uid, { getDb, lookup }),
  });
  const result = await handler(request());
  assert.deepEqual(await result.json(), { status: "linked" });
  assert.equal(requestedUid, UID);
  const [stored] = await harness.db.select().from(marketingAttributionSubjects);
  assert.equal(stored?.subjectId, UID);
  assert.equal(stored?.firstTouch?.campaign, "app-launch");
  assert.equal(stored?.firstTouch?.click_id_value, "");
  assert.equal(stored?.gclid, null);
  assert.equal(stored?.adUserDataConsent, "unspecified");
  assert.equal(stored?.consentProvenance?.subject_id, UID);
  const deployed = await harness.pglite.query<{ n: number }>(
    'SELECT count(*)::integer AS n FROM "sealai_deployment"."deploy_tasks"'
  );
  assert.equal(deployed.rows[0]?.n, 0);
});

test("missing authorization and analytics denial never write a subject", async () => {
  let called = false;
  const handler = createAcquisitionSyncHandler({
    authorize: async () => ({
      ok: false,
      response: new Response(null, { status: 401 }),
    }),
    sync: () => {
      called = true;
      return Promise.resolve("linked" as const);
    },
  });
  assert.equal((await handler(request())).status, 401);
  assert.equal(called, false);
  assert.equal(
    await fetchAccountAcquisition(UID, {
      config: CONFIG,
      fetch: () =>
        response({
          consent: {
            analytics_storage: "denied",
            ad_storage: "denied",
            ad_user_data: "denied",
            ad_personalization: "denied",
          },
        }),
    }),
    null
  );
  assert.equal(
    (await harness.db.select().from(marketingAttributionSubjects)).length,
    0
  );
});

test("receipt subject, raw hash and signature are verified; granted receipts retain clicks", async () => {
  for (const changes of [
    { subject_id: "other-user" },
    { sea_attr: Buffer.from('{"version":2}').toString("base64url") },
    { consent_token: "invalid.signature.token" },
  ]) {
    await assert.rejects(
      fetchAccountAcquisition(UID, {
        config: CONFIG,
        fetch: () => response(changes),
      })
    );
  }
  const linked = await fetchAccountAcquisition(UID, {
    config: CONFIG,
    fetch: () => response({}, true),
  });
  assert.equal(linked?.snapshot.gclid, "consented-click");
  assert.equal(linked?.snapshot.attribution_raw, RAW);
});

test("missing lookup is unmatched and unavailable lookup returns no private details", async () => {
  assert.equal(
    await syncAccountAcquisition(UID, { getDb, lookup: async () => null }),
    "unmatched"
  );
  const handler = createAcquisitionSyncHandler({
    authorize: async () => ({ ok: true, authorization: ACTOR }),
    sync: () => {
      return Promise.reject(new Error("private upstream secret"));
    },
  });
  const result = await handler(request());
  assert.equal(result.status, 503);
  assert.deepEqual(await result.json(), { status: "unavailable" });
});

test("authority config is explicit HTTPS without credentials, paths or query redirection", () => {
  assert.equal(acquisitionClientConfig({}), null);
  for (const url of [
    "http://remote.test",
    "https://user:secret@example.test",
    "https://example.test/path",
    "https://example.test?other=origin",
  ]) {
    assert.throws(() =>
      acquisitionClientConfig({
        MARKETING_ATTRIBUTION_API_BASE_URL: url,
        ACQUISITION_INGEST_SECRET: "secret",
      })
    );
  }
  assert.throws(() =>
    acquisitionClientConfig({ ACQUISITION_INGEST_SECRET: "secret" })
  );
});

test("durable lifecycle retry preserves event ID and stops after collector acknowledgement", async () => {
  await harness.db.insert(marketingLifecycleEvents).values({
    eventId: "deploy-event",
    eventName: "deploy_success",
    userId: UID,
    workspaceId: "team-workspace",
    deploymentId: "deployment-id",
    occurredAt: new Date("2026-10-29T01:00:00Z"),
    nextForwardAt: new Date(0),
  });
  const linked = await fetchAccountAcquisition(UID, {
    config: CONFIG,
    fetch: () => response(),
  });
  assert.ok(linked);
  const deliveries: unknown[] = [];
  let accepts = false;
  const options = {
    config: CONFIG,
    getDb,
    lookup: async () => linked,
    now: () => new Date("2026-10-29T02:00:00Z"),
    limit: 2,
    fetch: (_url: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        `Bearer ${CONFIG.secret}`
      );
      deliveries.push(JSON.parse(String(init?.body)));
      return Promise.resolve(
        new Response(null, { status: accepts ? 202 : 503 })
      );
    },
  };
  assert.deepEqual(await publishMarketingLifecycleBatch(options), {
    delivered: 0,
    failed: 1,
  });
  const [pending] = await harness.db.select().from(marketingLifecycleEvents);
  assert.equal(pending?.forwardAttempts, 1);
  assert.equal(pending?.forwardedAt, null);
  accepts = true;
  const later = { ...options, now: () => new Date("2026-10-29T03:00:00Z") };
  assert.deepEqual(await publishMarketingLifecycleBatch(later), {
    delivered: 1,
    failed: 0,
  });
  assert.deepEqual(await publishMarketingLifecycleBatch(later), {
    delivered: 0,
    failed: 0,
  });
  assert.equal(deliveries.length, 2);
  assert.deepEqual(deliveries[0], deliveries[1]);
  assert.equal((deliveries[1] as Record<string, unknown>).subject_id, UID);
  assert.equal(
    (deliveries[1] as Record<string, unknown>).workspace_id,
    "team-workspace"
  );
  assert.ok(
    (await harness.db.select().from(marketingLifecycleEvents))[0]?.forwardedAt
  );
});

test("withdrawn consent retains a durable event without external sending", async () => {
  await harness.db.insert(marketingLifecycleEvents).values({
    eventId: "withdrawn-event",
    eventName: "topup_success",
    userId: UID,
    occurredAt: new Date(0),
    nextForwardAt: new Date(0),
    transactionId: "verified-payment",
  });
  let sent = false;
  const result = await publishMarketingLifecycleBatch({
    config: CONFIG,
    getDb,
    lookup: async () => null,
    fetch: () => {
      sent = true;
      return Promise.resolve(new Response(null, { status: 202 }));
    },
  });
  assert.deepEqual(result, { delivered: 0, failed: 1 });
  assert.equal(sent, false);
  const [row] = await harness.db.select().from(marketingLifecycleEvents);
  assert.equal(row?.lastForwardError, "no_analytics_allowed_subject");
  assert.equal(row?.forwardedAt, null);
});
