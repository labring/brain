import { afterAll, test } from "bun:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

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
import {
  marketingAttributionSubjects,
  marketingLifecycleEvents,
} from "@/features/marketing/schema";
import {
  notificationMessages,
  notificationReadReceipts,
} from "@/features/notifications/schema";
import { onboardingProfiles } from "@/features/onboarding/schema";

import {
  createIdentityFingerprintStore,
  IdentityBindingSupersededError,
  requireCurrentIdentityBinding,
} from "./identity-fingerprint-core";

const assistantSchema = {
  assistantChatMessages,
  assistantChats,
  assistantDevboxRuntimes,
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

function seedInstallSession(input: {
  ownerIdentityVersion?: number;
  state: string;
  workspaceActor: string;
}) {
  return db.insert(githubAppInstallSessions).values({
    expiresAt: new Date("2026-08-01T00:00:00Z"),
    namespace: "session-ns",
    ownerIdentityVersion: input.ownerIdentityVersion ?? 2,
    state: input.state,
    workspaceActor: input.workspaceActor,
  });
}

function selectInstallSessions() {
  return db
    .select({
      ownerIdentityVersion: githubAppInstallSessions.ownerIdentityVersion,
      state: githubAppInstallSessions.state,
      workspaceActor: githubAppInstallSessions.workspaceActor,
    })
    .from(githubAppInstallSessions)
    .orderBy(githubAppInstallSessions.state);
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
const BINDING_REQUIRED_RE = /A verified identity binding is required\./;

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
  const consentProvenance = {
    issuer: "sealos-desktop",
    issued_at: "2026-08-13T00:00:00.000Z",
    jti: "merge-marketing-jti",
    region: "region-a",
    source: "desktop_oauth",
    subject_id: "tombstone-uid",
  } as const;
  await db.insert(deployTasks).values({
    id: "merge-marketing-task",
    marketingAttribution: {
      ad_personalization: "granted",
      ad_user_data_consent: "granted",
      click_id_candidates: [],
      consent_provenance: consentProvenance,
      first_touch: null,
      gbraid: null,
      gclid: "tombstone-gclid",
      last_touch: null,
      version: 3,
      wbraid: null,
    },
    namespace: "merge-marketing",
    phase: "completed",
    runner: { kind: "template" },
    source: { kind: "template", templateName: "merge-marketing" },
    status: "completed",
    target: { kind: "existingProject", projectId: "merge-marketing" },
  });
  await db.insert(marketingLifecycleEvents).values(
    (["one", "two", "three"] as const).map((suffix) => ({
      eventId: `merge-marketing-${suffix}`,
      eventName: "build_started" as const,
      consentProvenance,
      occurredAt: new Date("2026-08-13T00:00:00.000Z"),
      userId: "tombstone-uid",
    }))
  );

  const telemetry = await observeCapturingTelemetry({
    crName: "merge-cr",
    mintedAt: 4000,
    userUid: "survivor-uid",
  });

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
  const [marketingTask] = await db
    .select({ marketingAttribution: deployTasks.marketingAttribution })
    .from(deployTasks)
    .where(eq(deployTasks.id, "merge-marketing-task"));
  assert.equal(
    marketingTask?.marketingAttribution?.consent_provenance?.subject_id,
    "survivor-uid"
  );
  assert.deepEqual(
    (
      await db
        .select({
          userId: marketingLifecycleEvents.userId,
        })
        .from(marketingLifecycleEvents)
        .where(
          inArray(marketingLifecycleEvents.eventId, [
            "merge-marketing-one",
            "merge-marketing-two",
            "merge-marketing-three",
          ])
        )
    ).map((event) => event.userId),
    ["survivor-uid", "survivor-uid", "survivor-uid"]
  );
  assert.deepEqual(
    (
      await db
        .select({
          consentProvenance: marketingLifecycleEvents.consentProvenance,
        })
        .from(marketingLifecycleEvents)
        .where(
          inArray(marketingLifecycleEvents.eventId, [
            "merge-marketing-one",
            "merge-marketing-two",
            "merge-marketing-three",
          ])
        )
    ).map((event) => event.consentProvenance?.subject_id),
    ["survivor-uid", "survivor-uid", "survivor-uid"]
  );
  assert.deepEqual(
    await db
      .select({
        consentProvenance: marketingAttributionSubjects.consentProvenance,
        gclid: marketingAttributionSubjects.gclid,
        subjectId: marketingAttributionSubjects.subjectId,
        subjectType: marketingAttributionSubjects.subjectType,
      })
      .from(marketingAttributionSubjects)
      .where(
        inArray(marketingAttributionSubjects.subjectId, [
          "tombstone-uid",
          "survivor-uid",
        ])
      ),
    [
      {
        consentProvenance: {
          ...consentProvenance,
          subject_id: "survivor-uid",
        },
        gclid: "tombstone-gclid",
        subjectId: "survivor-uid",
        subjectType: "user",
      },
    ]
  );
  assert.equal(telemetry?.attributionSubjectsRekeyed, 1);
  assert.equal(telemetry?.attributionSubjectsReleased, 0);
  assert.equal(telemetry?.deployAttributionProvenanceRekeyed, 1);
  assert.equal(telemetry?.identityUidCanonicalizationsRekeyed, 1);
  assert.equal(telemetry?.lifecycleEventsRekeyed, 3);
  assert.deepEqual(
    await db
      .select()
      .from(identityUidCanonicalizations)
      .where(
        inArray(identityUidCanonicalizations.userUid, [
          "tombstone-uid",
          "survivor-uid",
        ])
      )
      .orderBy(identityUidCanonicalizations.userUid),
    [
      {
        canonicalUserUid: "survivor-uid",
        userUid: "survivor-uid",
      },
      {
        canonicalUserUid: "survivor-uid",
        userUid: "tombstone-uid",
      },
    ]
  );

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
  await db.insert(marketingAttributionSubjects).values([
    {
      gclid: "survivor-gclid",
      subjectId: "winner-uid",
      subjectType: "user",
    },
    {
      gclid: "tombstone-gclid",
      subjectId: "loser-uid",
      subjectType: "user",
    },
  ]);

  const telemetry = await observeCapturingTelemetry({
    crName: "winner-cr",
    mintedAt: 6000,
    userUid: "winner-uid",
  });

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
  assert.deepEqual(
    await db
      .select({
        gclid: marketingAttributionSubjects.gclid,
        subjectId: marketingAttributionSubjects.subjectId,
      })
      .from(marketingAttributionSubjects)
      .where(
        inArray(marketingAttributionSubjects.subjectId, [
          "loser-uid",
          "winner-uid",
        ])
      ),
    [{ gclid: "survivor-gclid", subjectId: "winner-uid" }]
  );
  assert.equal(telemetry?.attributionSubjectsRekeyed, 0);
  assert.equal(telemetry?.attributionSubjectsReleased, 1);
});

test("a merge re-keys pending current-generation authorization sessions and leaves legacy ones", async () => {
  await observe({
    crName: "session-cr",
    mintedAt: 4200,
    userUid: "session-tombstone-uid",
  });
  await seedInstallSession({
    state: "pending-current",
    workspaceActor: "session-tombstone-uid",
  });
  await seedInstallSession({
    ownerIdentityVersion: 1,
    state: "pending-legacy",
    workspaceActor: "session-cr",
  });
  await seedInstallSession({
    state: "pending-carol",
    workspaceActor: "session-carol-uid",
  });

  assert.deepEqual(
    await observe({
      crName: "session-cr",
      mintedAt: 4300,
      userUid: "session-survivor-uid",
    }),
    { outcome: "merge" }
  );

  // The pending flow completes for the survivor; a foreign owner and the
  // naturally expiring legacy row are never touched.
  assert.deepEqual(await selectInstallSessions(), [
    {
      ownerIdentityVersion: 2,
      state: "pending-carol",
      workspaceActor: "session-carol-uid",
    },
    {
      ownerIdentityVersion: 2,
      state: "pending-current",
      workspaceActor: "session-survivor-uid",
    },
    {
      ownerIdentityVersion: 1,
      state: "pending-legacy",
      workspaceActor: "session-cr",
    },
  ]);
});

// Full rows, so any field-level answer merging shows up in the deepEqual.
function selectProfiles(userUids: string[]) {
  return db
    .select()
    .from(onboardingProfiles)
    .where(inArray(onboardingProfiles.userUid, userUids))
    .orderBy(onboardingProfiles.userUid);
}

async function observeCapturingTelemetry(
  binding: Parameters<typeof observe>[0]
): Promise<Record<string, unknown> | undefined> {
  const infoCalls: unknown[][] = [];
  const originalInfo = console.info;
  console.info = (...args: unknown[]) => {
    infoCalls.push(args);
  };
  try {
    assert.deepEqual(await observe(binding), { outcome: "merge" });
  } finally {
    console.info = originalInfo;
  }
  return infoCalls.find(
    (args) =>
      args[0] === "[telemetry] account merge re-keyed personal resources"
  )?.[1] as Record<string, unknown> | undefined;
}

test("a merge re-keys the tombstone's onboarding profile when the survivor holds none", async () => {
  // ADR-0061: the profile is keyed by the bare uid, and updatedAt doubles as
  // the terminal timestamp — a re-key must not touch it.
  const terminalUpdatedAt = new Date("2026-06-20T08:00:00Z");
  await observe({
    crName: "profile-cr",
    mintedAt: 7000,
    userUid: "profile-tombstone-uid",
  });
  const tombstoneCreatedAt = new Date("2026-06-20T07:00:00Z");
  await db.insert(onboardingProfiles).values({
    createdAt: tombstoneCreatedAt,
    dismissedAtStep: 2,
    roleType: "founder",
    status: "dismissed",
    updatedAt: terminalUpdatedAt,
    userUid: "profile-tombstone-uid",
  });

  const telemetry = await observeCapturingTelemetry({
    crName: "profile-cr",
    mintedAt: 8000,
    userUid: "profile-survivor-uid",
  });

  // Only the key moved: every other column, answered or not, is verbatim.
  assert.deepEqual(
    await selectProfiles(["profile-tombstone-uid", "profile-survivor-uid"]),
    [
      {
        createdAt: tombstoneCreatedAt,
        dismissedAtStep: 2,
        openGoalText: null,
        priorityDisplayOrder: null,
        priorityOtherText: null,
        priorityTags: null,
        roleOtherText: null,
        roleType: "founder",
        status: "dismissed",
        updatedAt: terminalUpdatedAt,
        usageContext: null,
        usageOtherText: null,
        userUid: "profile-survivor-uid",
      },
    ]
  );
  assert.equal(telemetry?.profilesRekeyed, 1);
  assert.equal(telemetry?.profilesReleased, 0);
});

test("where both merged accounts hold a profile, the survivor's row wins and the tombstone's is deleted", async () => {
  await observe({
    crName: "profile-both-cr",
    mintedAt: 9000,
    userUid: "both-tombstone-uid",
  });
  // The tombstone answered everything; the survivor answered nothing. Any
  // field-level merging would surface as a non-null answer column below.
  const survivorTouchedAt = new Date("2026-06-21T09:00:00Z");
  await db.insert(onboardingProfiles).values([
    {
      openGoalText: "migrate the studio's client apps",
      priorityDisplayOrder: ["low_cost", "stability", "other"],
      priorityOtherText: "compliance",
      priorityTags: ["stability", "other"],
      roleOtherText: "agency owner",
      roleType: "other",
      status: "completed",
      usageContext: "team_or_client",
      usageOtherText: "client work",
      userUid: "both-tombstone-uid",
    },
    {
      createdAt: survivorTouchedAt,
      dismissedAtStep: 1,
      status: "dismissed",
      updatedAt: survivorTouchedAt,
      userUid: "both-survivor-uid",
    },
  ]);

  const telemetry = await observeCapturingTelemetry({
    crName: "profile-both-cr",
    mintedAt: 9500,
    userUid: "both-survivor-uid",
  });

  assert.deepEqual(
    await selectProfiles(["both-tombstone-uid", "both-survivor-uid"]),
    [
      {
        createdAt: survivorTouchedAt,
        dismissedAtStep: 1,
        openGoalText: null,
        priorityDisplayOrder: null,
        priorityOtherText: null,
        priorityTags: null,
        roleOtherText: null,
        roleType: null,
        status: "dismissed",
        updatedAt: survivorTouchedAt,
        usageContext: null,
        usageOtherText: null,
        userUid: "both-survivor-uid",
      },
    ]
  );
  assert.equal(telemetry?.profilesRekeyed, 0);
  assert.equal(telemetry?.profilesReleased, 1);
});

function selectReceipts(userUids: string[]) {
  return db
    .select({
      messageId: notificationReadReceipts.messageId,
      messageKey: notificationReadReceipts.messageKey,
      userUid: notificationReadReceipts.userUid,
    })
    .from(notificationReadReceipts)
    .where(inArray(notificationReadReceipts.userUid, userUids))
    .orderBy(
      notificationReadReceipts.userUid,
      notificationReadReceipts.messageKey
    );
}

function selectMessages(userUids: string[]) {
  return db
    .select({
      dedupeKey: notificationMessages.dedupeKey,
      id: notificationMessages.id,
      namespace: notificationMessages.namespace,
      releasedAt: notificationMessages.releasedAt,
      userUid: notificationMessages.userUid,
    })
    .from(notificationMessages)
    .where(inArray(notificationMessages.userUid, userUids))
    .orderBy(notificationMessages.userUid, notificationMessages.id);
}

test("a merge re-keys the tombstone's read receipts and drops those the survivor already holds", async () => {
  await observe({
    crName: "receipt-cr",
    mintedAt: 10_000,
    userUid: "receipt-tombstone-uid",
  });
  await db.insert(notificationMessages).values({
    dedupeKey: "quota-exhausted:receipt-ns:cpu",
    id: "receipt-msg",
    kind: "quota-exhausted",
    namespace: "receipt-ns",
    payload: { kind: "quota-exhausted", limit: 1, resource: "cpu", used: 1 },
  });
  await db.insert(notificationReadReceipts).values([
    // Only the tombstone read these: they follow the survivor, the db one
    // still attached to its row.
    {
      messageKey: "cr:debt-choice-debtperiod:1",
      userUid: "receipt-tombstone-uid",
    },
    {
      messageId: "receipt-msg",
      messageKey: "db:receipt-msg",
      userUid: "receipt-tombstone-uid",
    },
    // Both read this one: the survivor's stands, the tombstone's is dropped.
    {
      messageKey: "cr:workspace-debt-debt:1",
      userUid: "receipt-tombstone-uid",
    },
    { messageKey: "cr:workspace-debt-debt:1", userUid: "receipt-survivor-uid" },
  ]);

  const telemetry = await observeCapturingTelemetry({
    crName: "receipt-cr",
    mintedAt: 11_000,
    userUid: "receipt-survivor-uid",
  });

  assert.deepEqual(
    await selectReceipts(["receipt-tombstone-uid", "receipt-survivor-uid"]),
    [
      {
        messageId: null,
        messageKey: "cr:debt-choice-debtperiod:1",
        userUid: "receipt-survivor-uid",
      },
      {
        messageId: null,
        messageKey: "cr:workspace-debt-debt:1",
        userUid: "receipt-survivor-uid",
      },
      {
        messageId: "receipt-msg",
        messageKey: "db:receipt-msg",
        userUid: "receipt-survivor-uid",
      },
    ]
  );
  assert.equal(telemetry?.receiptsRekeyed, 2);
  assert.equal(telemetry?.receiptsReleased, 1);
});

test("a merge re-keys the tombstone's account-scoped messages, key included, and collapses onto the survivor's live row", async () => {
  await observe({
    crName: "message-cr",
    mintedAt: 12_000,
    userUid: "message-tombstone-uid",
  });
  const giftPayload = {
    giftMicroUnits: 1_000_000,
    kind: "credit-hint",
  } as const;
  await db.insert(notificationMessages).values([
    // The tombstone's welcome, observed in its own workspace.
    {
      dedupeKey: "credit-hint:message-tombstone-uid",
      id: "message-tombstone-gift",
      kind: "credit-hint",
      namespace: "tombstone-ns",
      payload: giftPayload,
      userUid: "message-tombstone-uid",
    },
  ]);

  const first = await observeCapturingTelemetry({
    crName: "message-cr",
    mintedAt: 13_000,
    userUid: "message-survivor-uid",
  });

  // The row and its dedupe key follow the survivor: a later gift observation
  // for the survivor finds this row and writes no second welcome.
  assert.deepEqual(
    await selectMessages(["message-tombstone-uid", "message-survivor-uid"]),
    [
      {
        dedupeKey: "credit-hint:message-survivor-uid",
        id: "message-tombstone-gift",
        namespace: "tombstone-ns",
        releasedAt: null,
        userUid: "message-survivor-uid",
      },
    ]
  );
  assert.equal(first?.messagesRekeyed, 1);
  assert.equal(first?.messagesReleased, 0);

  // A second merge into the same survivor, from an account that also holds
  // a live welcome: one row per person, so the newcomer's is deleted and
  // its receipt cascades.
  await observe({
    crName: "message-cr-2",
    mintedAt: 14_000,
    userUid: "message-tombstone-2-uid",
  });
  await db.insert(notificationMessages).values({
    dedupeKey: "credit-hint:message-tombstone-2-uid",
    id: "message-tombstone-2-gift",
    kind: "credit-hint",
    namespace: "tombstone-2-ns",
    payload: giftPayload,
    userUid: "message-tombstone-2-uid",
  });
  await db.insert(notificationReadReceipts).values({
    messageId: "message-tombstone-2-gift",
    messageKey: "db:message-tombstone-2-gift",
    userUid: "message-tombstone-2-uid",
  });

  const second = await observeCapturingTelemetry({
    crName: "message-cr-2",
    mintedAt: 15_000,
    userUid: "message-survivor-uid",
  });

  assert.deepEqual(
    (
      await selectMessages(["message-tombstone-2-uid", "message-survivor-uid"])
    ).map((row) => row.id),
    ["message-tombstone-gift"]
  );
  assert.deepEqual(
    await selectReceipts(["message-tombstone-2-uid", "message-survivor-uid"]),
    []
  );
  assert.equal(second?.messagesRekeyed, 0);
  assert.equal(second?.messagesReleased, 1);
});

test("a write-transaction re-check passes only while the binding is current", async () => {
  await observe({ crName: "guard-cr", mintedAt: 5100, userUid: "guard-uid" });

  // Current binding: the guarded write proceeds.
  await db.transaction((tx) =>
    requireCurrentIdentityBinding(tx, {
      crName: "guard-cr",
      userUid: "guard-uid",
    })
  );

  // After a merge re-points the crName, the stale uid is refused in the
  // write transaction — the race the authorization-time observation alone
  // cannot close.
  await observe({
    crName: "guard-cr",
    mintedAt: 5200,
    userUid: "guard-survivor-uid",
  });
  await assert.rejects(
    db.transaction((tx) =>
      requireCurrentIdentityBinding(tx, {
        crName: "guard-cr",
        userUid: "guard-uid",
      })
    ),
    IdentityBindingSupersededError
  );
  await db.transaction((tx) =>
    requireCurrentIdentityBinding(tx, {
      crName: "guard-cr",
      userUid: "guard-survivor-uid",
    })
  );

  // A crName that was never observed fails closed, and an empty identity is
  // a caller bug rather than a supersession.
  await assert.rejects(
    db.transaction((tx) =>
      requireCurrentIdentityBinding(tx, {
        crName: "never-observed-cr",
        userUid: "guard-uid",
      })
    ),
    IdentityBindingSupersededError
  );
  await assert.rejects(
    db.transaction((tx) =>
      requireCurrentIdentityBinding(tx, { crName: " ", userUid: "guard-uid" })
    ),
    BINDING_REQUIRED_RE
  );
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
