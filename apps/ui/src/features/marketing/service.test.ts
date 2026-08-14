import { mock, test } from "bun:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { SignJWT } from "jose";

import type { AssistantPgDatabase } from "@/features/chat/persistence/db";
import {
  assistantChatMessages,
  assistantChats,
  assistantDevboxRuntimes,
  assistantEntitlements,
  githubAppInstallSessions,
  githubConnections,
  githubOauthConnections,
  identityFingerprints,
  identityUidCanonicalizations,
} from "@/features/chat/persistence/schema";
import { deployTasks } from "@/features/deploy/task/schema";
import { onboardingProfiles } from "@/features/onboarding/schema";
import { createIdentityFingerprintStore } from "@/lib/identity-fingerprint-core";
import type { MarketingPgDatabase } from "./db";
import {
  marketingAttributionSubjects,
  marketingLifecycleEvents,
} from "./schema";

mock.module("server-only", () => ({}));
const { recordMarketingLifecycleEvent } = await import("./service");

const SIGNING_KEY = "marketing-service-test-signing-key";
const RAW_ATTRIBUTION = "delayed-event-attribution";

async function consentToken(subject: string): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000);
  return await new SignJWT({
    ad_personalization: "granted",
    ad_user_data_consent: "granted",
    attribution_hash: createHash("sha256")
      .update(RAW_ATTRIBUTION)
      .digest("hex"),
    consent_source: "desktop_oauth",
    region: "global",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("sealos-desktop")
    .setAudience("brain-marketing-attribution")
    .setSubject(subject)
    .setJti("delayed-event-jti")
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + 600)
    .sign(new TextEncoder().encode(SIGNING_KEY));
}

test("delayed lifecycle ingest commits only the survivor UID after a merge", async () => {
  const previousSigningKey = process.env.MARKETING_CONSENT_SIGNING_KEY;
  process.env.MARKETING_CONSENT_SIGNING_KEY = SIGNING_KEY;
  const pglite = new PGlite();
  const schema = {
    assistantChatMessages,
    assistantChats,
    assistantDevboxRuntimes,
    assistantEntitlements,
    deployTasks,
    githubAppInstallSessions,
    githubConnections,
    githubOauthConnections,
    identityFingerprints,
    identityUidCanonicalizations,
    marketingAttributionSubjects,
    marketingLifecycleEvents,
    onboardingProfiles,
  };
  const db = drizzle(pglite, { schema });
  await migrate(db, {
    migrationsFolder: path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../drizzle"
    ),
  });
  const observe = createIdentityFingerprintStore(
    () => db as unknown as AssistantPgDatabase
  );
  await observe({
    crName: "delayed-event-cr",
    mintedAt: 1,
    userUid: "delayed-event-tombstone",
  });

  let releaseIngest!: () => void;
  const ingestPaused = new Promise<void>((resolve) => {
    releaseIngest = resolve;
  });
  let markIngestReady!: () => void;
  const ingestReady = new Promise<void>((resolve) => {
    markIngestReady = resolve;
  });
  const ingest = recordMarketingLifecycleEvent(
    {
      ad_personalization: "granted",
      ad_user_data_consent: "granted",
      attribution_raw: RAW_ATTRIBUTION,
      click_id_candidates: [],
      consent_provenance: null,
      consent_token: await consentToken("delayed-event-tombstone"),
      deployment_id: null,
      event_id: "delayed-event-id",
      event_name: "running_24h",
      first_touch: null,
      gbraid: null,
      gclid: "delayed-event-gclid",
      last_touch: null,
      occurred_at: "2026-08-14T00:00:00.000Z",
      user_id: "delayed-event-tombstone",
      version: 3,
      wbraid: null,
      workspace_id: "delayed-event-workspace",
    },
    {
      beforeTransaction: async () => {
        markIngestReady();
        await ingestPaused;
      },
      getDb: () => db as unknown as MarketingPgDatabase,
    }
  );

  try {
    await ingestReady;
    assert.deepEqual(
      await observe({
        crName: "delayed-event-cr",
        mintedAt: 2,
        userUid: "delayed-event-survivor",
      }),
      { outcome: "merge" }
    );
    releaseIngest();
    assert.equal(await ingest, "created");

    const [event] = await db
      .select()
      .from(marketingLifecycleEvents)
      .where(eq(marketingLifecycleEvents.eventId, "delayed-event-id"));
    assert.equal(event?.userId, "delayed-event-survivor");
    assert.equal(
      event?.consentProvenance?.subject_id,
      "delayed-event-survivor"
    );
    assert.deepEqual(
      await db
        .select({
          subjectId: marketingAttributionSubjects.subjectId,
          subjectType: marketingAttributionSubjects.subjectType,
        })
        .from(marketingAttributionSubjects)
        .where(
          inArray(marketingAttributionSubjects.subjectId, [
            "delayed-event-tombstone",
            "delayed-event-survivor",
          ])
        ),
      [
        {
          subjectId: "delayed-event-survivor",
          subjectType: "user",
        },
      ]
    );

    assert.equal(
      await recordMarketingLifecycleEvent(
        {
          ad_personalization: "unspecified",
          ad_user_data_consent: "unspecified",
          click_id_candidates: [],
          consent_provenance: null,
          deployment_id: null,
          event_id: "unsigned-event-id",
          event_name: "running_24h",
          first_touch: null,
          gbraid: null,
          gclid: null,
          last_touch: null,
          occurred_at: "2026-08-14T01:00:00.000Z",
          user_id: "unsigned-user",
          version: 3,
          wbraid: null,
          workspace_id: "delayed-event-workspace",
        },
        { getDb: () => db as unknown as MarketingPgDatabase }
      ),
      "created"
    );
    const [unsignedEvent] = await db
      .select({ userId: marketingLifecycleEvents.userId })
      .from(marketingLifecycleEvents)
      .where(eq(marketingLifecycleEvents.eventId, "unsigned-event-id"));
    assert.equal(unsignedEvent?.userId, null);
    assert.equal(
      (
        await db
          .select()
          .from(marketingAttributionSubjects)
          .where(eq(marketingAttributionSubjects.subjectId, "unsigned-user"))
      ).length,
      0
    );
  } finally {
    releaseIngest();
    await ingest.catch(() => undefined);
    await pglite.close();
    if (previousSigningKey == null) {
      delete process.env.MARKETING_CONSENT_SIGNING_KEY;
    } else {
      process.env.MARKETING_CONSENT_SIGNING_KEY = previousSigningKey;
    }
  }
});
