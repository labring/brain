import { afterAll, test } from "bun:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { SignJWT } from "jose";

import {
  assistantChatMessages,
  assistantChats,
  assistantEntitlements,
  githubAppInstallSessions,
  githubConnections,
  githubOauthConnections,
  identityFingerprints,
} from "@/features/chat/persistence/schema";
import { createIdentityFingerprintStore } from "@/lib/identity-fingerprint-core";

import {
  createOnboardingProfileHandlers,
  type OnboardingProfileHandlerDependencies,
} from "./profile-http-handlers";
import { createOnboardingProfileStore } from "./profile-store";
import { onboardingProfiles } from "./schema";

const testSchema = {
  assistantChatMessages,
  assistantChats,
  assistantEntitlements,
  githubAppInstallSessions,
  githubConnections,
  githubOauthConnections,
  identityFingerprints,
  onboardingProfiles,
};

const pglite = new PGlite();
const db = drizzle(pglite, { schema: testSchema });
await migrate(db, {
  migrationsFolder: path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../drizzle"
  ),
});

const store = createOnboardingProfileStore(() => db);
const observeFingerprint = createIdentityFingerprintStore(() => db);

afterAll(() => pglite.close());

const APP_TOKEN_SECRET = "cluster-shared-jwt-internal";
const APP_TOKEN_CONFIG = { secret: APP_TOKEN_SECRET };
const APP_TOKEN_MINTED_AT = 1_753_600_000;

function mintAppToken(crName: string, secret = APP_TOKEN_SECRET) {
  return new SignJWT({
    userCrName: crName,
    userUid: `${crName}-uid`,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(APP_TOKEN_MINTED_AT)
    .sign(new TextEncoder().encode(secret));
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

async function samplingRequest(
  workspaceActor: string,
  appToken?: string | null
): Promise<Request> {
  return new Request(
    "https://brain.test/api/onboarding-profile/sampling?namespace=shared",
    {
      headers: {
        Authorization: `Bearer ${encodedKubeconfig("shared", workspaceActor)}`,
        ...(appToken === null
          ? {}
          : {
              "X-Sealos-App-Token":
                appToken ?? (await mintAppToken(workspaceActor)),
            }),
      },
    }
  );
}

async function dismissRequest(
  workspaceActor: string,
  body: unknown,
  options: { appToken?: string | null; namespace?: string } = {}
): Promise<Request> {
  const namespace = options.namespace ?? "shared";
  return new Request(
    `https://brain.test/api/onboarding-profile/dismiss?namespace=${namespace}`,
    {
      body: JSON.stringify(body),
      headers: {
        Authorization: `Bearer ${encodedKubeconfig("shared", workspaceActor)}`,
        "content-type": "application/json",
        ...(options.appToken === null
          ? {}
          : {
              "X-Sealos-App-Token":
                options.appToken ?? (await mintAppToken(workspaceActor)),
            }),
      },
      method: "POST",
    }
  );
}

async function stepRequest(
  workspaceActor: string,
  body: unknown,
  options: { appToken?: string | null; namespace?: string } = {}
): Promise<Request> {
  const namespace = options.namespace ?? "shared";
  return new Request(
    `https://brain.test/api/onboarding-profile/step?namespace=${namespace}`,
    {
      body: JSON.stringify(body),
      headers: {
        Authorization: `Bearer ${encodedKubeconfig("shared", workspaceActor)}`,
        "content-type": "application/json",
        ...(options.appToken === null
          ? {}
          : {
              "X-Sealos-App-Token":
                options.appToken ?? (await mintAppToken(workspaceActor)),
            }),
      },
      method: "POST",
    }
  );
}

async function completeRequest(
  workspaceActor: string,
  body: unknown,
  options: { appToken?: string | null; namespace?: string } = {}
): Promise<Request> {
  const namespace = options.namespace ?? "shared";
  return new Request(
    `https://brain.test/api/onboarding-profile/complete?namespace=${namespace}`,
    {
      body: JSON.stringify(body),
      headers: {
        Authorization: `Bearer ${encodedKubeconfig("shared", workspaceActor)}`,
        "content-type": "application/json",
        ...(options.appToken === null
          ? {}
          : {
              "X-Sealos-App-Token":
                options.appToken ?? (await mintAppToken(workspaceActor)),
            }),
      },
      method: "POST",
    }
  );
}

function handlers(
  overrides: Partial<OnboardingProfileHandlerDependencies> = {}
) {
  return createOnboardingProfileHandlers({
    answerStep: store.answerStep,
    appTokenConfig: APP_TOKEN_CONFIG,
    complete: store.complete,
    dismiss: store.dismiss,
    isSampled: store.isSampled,
    observeFingerprint,
    verify: () => Promise.resolve({ ok: true }),
    ...overrides,
  });
}

async function profileRow(userUid: string) {
  const [row] = await db
    .select()
    .from(onboardingProfiles)
    .where(eq(onboardingProfiles.userUid, userUid));
  return row;
}

test("the sampling verdict pins all four row shapes", async () => {
  const { sampling } = handlers();
  await db.insert(onboardingProfiles).values([
    { status: "in_progress", userUid: "shape-progress-cr-uid" },
    { status: "completed", userUid: "shape-completed-cr-uid" },
    {
      dismissedAtStep: 3,
      status: "dismissed",
      userUid: "shape-dismissed-cr-uid",
    },
  ]);

  const verdicts: Record<string, unknown> = {};
  for (const crName of [
    "shape-none-cr",
    "shape-progress-cr",
    "shape-completed-cr",
    "shape-dismissed-cr",
  ]) {
    const response = await sampling(await samplingRequest(crName));
    assert.equal(response.status, 200);
    verdicts[crName] = await response.json();
  }

  assert.deepEqual(verdicts, {
    "shape-completed-cr": { sampled: true },
    "shape-dismissed-cr": { sampled: true },
    "shape-none-cr": { sampled: false },
    "shape-progress-cr": { sampled: false },
  });
});

test("answering Step 1 upserts an in_progress row that still counts as Unsampled", async () => {
  const { answerStep, sampling } = handlers();

  const response = await answerStep(
    await stepRequest("step1-cr", {
      roleOtherText: null,
      roleType: "founder",
      step: 1,
    })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "in_progress" });
  const row = await profileRow("step1-cr-uid");
  assert.equal(row?.status, "in_progress");
  assert.equal(row?.roleType, "founder");
  assert.equal(row?.roleOtherText, null);
  assert.equal(row?.dismissedAtStep, null);

  // Abandoning the tab here leaves exactly this row — the person is still
  // Unsampled, so the dialog shows again on the next entry.
  const verdict = await sampling(await samplingRequest("step1-cr"));
  assert.deepEqual(await verdict.json(), { sampled: false });
});

test("Steps 1-3 accumulate answers on the person's single row", async () => {
  const { answerStep, sampling } = handlers();

  await answerStep(
    await stepRequest("accumulate-cr", {
      roleOtherText: null,
      roleType: "founder",
      step: 1,
    })
  );
  await answerStep(
    await stepRequest("accumulate-cr", {
      step: 2,
      usageContext: "real_business",
      usageOtherText: null,
    })
  );
  const response = await answerStep(
    await stepRequest("accumulate-cr", {
      priorityDisplayOrder: [
        "stability",
        "low_cost",
        "ease_of_use",
        "performance",
        "fast_launch",
        "scalability",
        "other",
      ],
      priorityOtherText: null,
      priorityTags: ["low_cost", "stability"],
      step: 3,
    })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "in_progress" });
  const row = await profileRow("accumulate-cr-uid");
  // Every step's answer is on the one row; no step write clobbers another.
  assert.equal(row?.roleType, "founder");
  assert.equal(row?.usageContext, "real_business");
  assert.equal(row?.usageOtherText, null);
  // Array order = click order, distinct from the displayed order.
  assert.deepEqual(row?.priorityTags, ["low_cost", "stability"]);
  assert.deepEqual(row?.priorityDisplayOrder, [
    "stability",
    "low_cost",
    "ease_of_use",
    "performance",
    "fast_launch",
    "scalability",
    "other",
  ]);
  assert.equal(row?.status, "in_progress");

  // Short of terminal, three answered steps still mean Unsampled.
  const verdict = await sampling(await samplingRequest("accumulate-cr"));
  assert.deepEqual(await verdict.json(), { sampled: false });
});

test("re-answering Step 1 after an abandoned attempt replaces the whole Other pair", async () => {
  const { answerStep } = handlers();

  // First visit: Other with free text, then the tab dies mid-survey.
  await answerStep(
    await stepRequest("redo-cr", {
      roleOtherText: "platform team lead",
      roleType: "other",
      step: 1,
    })
  );
  const abandoned = await profileRow("redo-cr-uid");
  assert.equal(abandoned?.roleType, "other");
  assert.equal(abandoned?.roleOtherText, "platform team lead");

  // Next entry restarts cleanly from Step 1; the new answer overwrites the
  // pair — no stale Other text can survive a non-Other pick.
  const response = await answerStep(
    await stepRequest("redo-cr", {
      roleOtherText: null,
      roleType: "student",
      step: 1,
    })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "in_progress" });
  const row = await profileRow("redo-cr-uid");
  assert.equal(row?.roleType, "student");
  assert.equal(row?.roleOtherText, null);
});

test("Skip after answering Step 1 keeps the role answer on the dismissed row", async () => {
  const { answerStep, dismiss, sampling } = handlers();

  await answerStep(
    await stepRequest("answer-skip-cr", {
      roleOtherText: "solo consultant",
      roleType: "other",
      step: 1,
    })
  );
  const response = await dismiss(
    await dismissRequest("answer-skip-cr", { dismissedAtStep: 2 })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    dismissedAtStep: 2,
    status: "dismissed",
  });
  const row = await profileRow("answer-skip-cr-uid");
  assert.equal(row?.status, "dismissed");
  assert.equal(row?.roleType, "other");
  assert.equal(row?.roleOtherText, "solo consultant");

  const verdict = await sampling(await samplingRequest("answer-skip-cr"));
  assert.deepEqual(await verdict.json(), { sampled: true });
});

test("Skip records a terminal dismissed profile with the step number", async () => {
  const { dismiss, sampling } = handlers();

  const response = await dismiss(
    await dismissRequest("skip-cr", { dismissedAtStep: 1 })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    dismissedAtStep: 1,
    status: "dismissed",
  });
  const row = await profileRow("skip-cr-uid");
  assert.equal(row?.status, "dismissed");
  assert.equal(row?.dismissedAtStep, 1);
  assert.equal(row?.roleType, null);

  const verdict = await sampling(await samplingRequest("skip-cr"));
  assert.deepEqual(await verdict.json(), { sampled: true });
});

test("dismiss finalizes an abandoned in_progress row without clobbering answers", async () => {
  const { dismiss } = handlers();
  await db.insert(onboardingProfiles).values({
    roleType: "founder",
    status: "in_progress",
    userUid: "resume-cr-uid",
  });

  const response = await dismiss(
    await dismissRequest("resume-cr", { dismissedAtStep: 2 })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    dismissedAtStep: 2,
    status: "dismissed",
  });
  const row = await profileRow("resume-cr-uid");
  assert.equal(row?.status, "dismissed");
  assert.equal(row?.dismissedAtStep, 2);
  assert.equal(row?.roleType, "founder");
});

test("Submit & Enter Console completes the accumulated row terminally", async () => {
  const { answerStep, complete, sampling } = handlers();

  await answerStep(
    await stepRequest("finish-cr", {
      roleOtherText: null,
      roleType: "individual_developer",
      step: 1,
    })
  );
  await answerStep(
    await stepRequest("finish-cr", {
      step: 2,
      usageContext: "side_project",
      usageOtherText: null,
    })
  );
  const response = await complete(
    await completeRequest("finish-cr", {
      openGoalText: "deploy an AI agent",
    })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    dismissedAtStep: null,
    status: "completed",
  });
  const row = await profileRow("finish-cr-uid");
  assert.equal(row?.status, "completed");
  assert.equal(row?.openGoalText, "deploy an AI agent");
  // Completing finalizes the row; every answered step stays on it.
  assert.equal(row?.roleType, "individual_developer");
  assert.equal(row?.usageContext, "side_project");
  assert.equal(row?.dismissedAtStep, null);

  // Completed is terminal: the person is Sampled and the dialog never
  // shows again.
  const verdict = await sampling(await samplingRequest("finish-cr"));
  assert.deepEqual(await verdict.json(), { sampled: true });
});

test("the Step 4 text is optional: an empty submit completes cleanly", async () => {
  const { complete, sampling } = handlers();

  const response = await complete(
    await completeRequest("finish-empty-cr", { openGoalText: null })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    dismissedAtStep: null,
    status: "completed",
  });
  const row = await profileRow("finish-empty-cr-uid");
  assert.equal(row?.status, "completed");
  assert.equal(row?.openGoalText, null);

  const verdict = await sampling(await samplingRequest("finish-empty-cr"));
  assert.deepEqual(await verdict.json(), { sampled: true });
});

test("terminal wins: complete against a terminal row is a no-op returning the current state", async () => {
  const { complete, dismiss } = handlers();

  // Against a dismissed row: the dismissal stands untouched.
  await dismiss(await dismissRequest("late-finish-cr", { dismissedAtStep: 2 }));
  const dismissedBefore = await profileRow("late-finish-cr-uid");
  const ontoDismissed = await complete(
    await completeRequest("late-finish-cr", { openGoalText: "too late" })
  );
  assert.equal(ontoDismissed.status, 200);
  assert.deepEqual(await ontoDismissed.json(), {
    dismissedAtStep: 2,
    status: "dismissed",
  });
  assert.deepEqual(await profileRow("late-finish-cr-uid"), dismissedBefore);

  // Against a completed row: a fire-and-forget retry changes nothing.
  await complete(
    await completeRequest("twice-finish-cr", { openGoalText: "first goal" })
  );
  const completedBefore = await profileRow("twice-finish-cr-uid");
  const again = await complete(
    await completeRequest("twice-finish-cr", { openGoalText: "second goal" })
  );
  assert.equal(again.status, 200);
  assert.deepEqual(await again.json(), {
    dismissedAtStep: null,
    status: "completed",
  });
  assert.deepEqual(await profileRow("twice-finish-cr-uid"), completedBefore);
});

test("terminal wins: a later dismiss is a no-op returning the current state", async () => {
  const { dismiss } = handlers();

  const first = await dismiss(
    await dismissRequest("terminal-cr", { dismissedAtStep: 1 })
  );
  assert.equal(first.status, 200);
  const rowAfterFirst = await profileRow("terminal-cr-uid");

  const second = await dismiss(
    await dismissRequest("terminal-cr", { dismissedAtStep: 3 })
  );
  assert.equal(second.status, 200);
  assert.deepEqual(await second.json(), {
    dismissedAtStep: 1,
    status: "dismissed",
  });
  assert.deepEqual(await profileRow("terminal-cr-uid"), rowAfterFirst);
});

test("terminal wins: a step answer against a terminal row is a no-op reporting that status", async () => {
  const { answerStep } = handlers();
  await db.insert(onboardingProfiles).values([
    { dismissedAtStep: 1, status: "dismissed", userUid: "late-skip-cr-uid" },
    { roleType: "founder", status: "completed", userUid: "late-done-cr-uid" },
  ]);
  const dismissedBefore = await profileRow("late-skip-cr-uid");
  const completedBefore = await profileRow("late-done-cr-uid");

  const ontoDismissed = await answerStep(
    await stepRequest("late-skip-cr", {
      roleOtherText: null,
      roleType: "student",
      step: 1,
    })
  );
  assert.equal(ontoDismissed.status, 200);
  assert.deepEqual(await ontoDismissed.json(), { status: "dismissed" });
  assert.deepEqual(await profileRow("late-skip-cr-uid"), dismissedBefore);

  const ontoCompleted = await answerStep(
    await stepRequest("late-done-cr", {
      roleOtherText: null,
      roleType: "student",
      step: 1,
    })
  );
  assert.equal(ontoCompleted.status, 200);
  assert.deepEqual(await ontoCompleted.json(), { status: "completed" });
  assert.deepEqual(await profileRow("late-done-cr-uid"), completedBefore);
});

test("a dismiss against a completed profile reports the completed state untouched", async () => {
  const { dismiss } = handlers();
  await db.insert(onboardingProfiles).values({
    status: "completed",
    userUid: "done-cr-uid",
  });
  const rowBefore = await profileRow("done-cr-uid");

  const response = await dismiss(
    await dismissRequest("done-cr", { dismissedAtStep: 4 })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    dismissedAtStep: null,
    status: "completed",
  });
  assert.deepEqual(await profileRow("done-cr-uid"), rowBefore);
});

test("an out-of-range or malformed dismiss body is refused before any write", async () => {
  const { dismiss } = handlers();

  for (const body of [
    { dismissedAtStep: 0 },
    { dismissedAtStep: 5 },
    { dismissedAtStep: 1.5 },
    {},
    null,
  ]) {
    const response = await dismiss(await dismissRequest("invalid-cr", body));
    assert.equal(response.status, 400);
  }

  assert.equal(await profileRow("invalid-cr-uid"), undefined);
});

test("a malformed step answer is refused before any write", async () => {
  const { answerStep } = handlers();

  for (const body of [
    // Unknown Cohort Tag.
    { roleOtherText: null, roleType: "wizard", step: 1 },
    // Loose text: Other text without the `other` tag.
    { roleOtherText: "platform team lead", roleType: "founder", step: 1 },
    // Blank text must be normalized to null by the client, not stored.
    { roleOtherText: "   ", roleType: "other", step: 1 },
    // Over the length bound.
    { roleOtherText: "x".repeat(501), roleType: "other", step: 1 },
    // Step 2 without its full column pair.
    { step: 2, usageContext: "exploring" },
    // Step 2 loose text: Other text without the `other` tag.
    { step: 2, usageContext: "exploring", usageOtherText: "just looking" },
    // Step 4 has no stepwise member — its answer travels on complete.
    { openGoalText: "ship it", step: 4 },
    { roleType: "founder" },
    {},
    null,
  ]) {
    const response = await answerStep(await stepRequest("bad-step-cr", body));
    assert.equal(response.status, 400);
  }

  assert.equal(await profileRow("bad-step-cr-uid"), undefined);
});

const FULL_DISPLAY_ORDER = [
  "ease_of_use",
  "stability",
  "low_cost",
  "performance",
  "scalability",
  "fast_launch",
  "other",
] as const;

test("a malformed Step 3 answer is refused before any write", async () => {
  const { answerStep } = handlers();

  const valid = {
    priorityDisplayOrder: [...FULL_DISPLAY_ORDER],
    priorityOtherText: null,
    priorityTags: ["ease_of_use"],
    step: 3,
  };
  for (const body of [
    // A fourth tag is over the cap.
    {
      ...valid,
      priorityTags: ["ease_of_use", "stability", "low_cost", "performance"],
    },
    // Zero tags: Next is gated on at least one.
    { ...valid, priorityTags: [] },
    // Duplicate tags are not distinct picks.
    { ...valid, priorityTags: ["stability", "stability"] },
    // Loose text: Other text without the `other` tag among the picks.
    { ...valid, priorityOtherText: "fair pricing" },
    // The display order must be the full vocabulary…
    { ...valid, priorityDisplayOrder: FULL_DISPLAY_ORDER.slice(0, 6) },
    // …with every tag exactly once…
    {
      ...valid,
      priorityDisplayOrder: [
        ...FULL_DISPLAY_ORDER.slice(0, 5),
        "other",
        "other",
      ],
    },
    // …and Other pinned last.
    { ...valid, priorityDisplayOrder: [...FULL_DISPLAY_ORDER].reverse() },
  ]) {
    const response = await answerStep(await stepRequest("bad-three-cr", body));
    assert.equal(response.status, 400);
  }

  assert.equal(await profileRow("bad-three-cr-uid"), undefined);
});

test("a malformed complete body is refused before any write", async () => {
  const { complete } = handlers();

  for (const body of [
    // The key is required even though the text is optional.
    {},
    // Blank text must be normalized to null by the client, not stored.
    { openGoalText: "   " },
    // Over the length bound.
    { openGoalText: "x".repeat(2001) },
    null,
  ]) {
    const response = await complete(
      await completeRequest("bad-finish-cr", body)
    );
    assert.equal(response.status, 400);
  }

  assert.equal(await profileRow("bad-finish-cr-uid"), undefined);
});

test("complete fails closed without the app token", async () => {
  const { complete } = handlers();

  const response = await complete(
    await completeRequest(
      "closed-finish-cr",
      { openGoalText: null },
      { appToken: null }
    )
  );

  assert.equal(response.status, 401);
  assert.equal(await profileRow("closed-finish-cr-uid"), undefined);
});

test("the step answer fails closed without the app token", async () => {
  const { answerStep } = handlers();

  const response = await answerStep(
    await stepRequest(
      "closed-step-cr",
      { roleOtherText: null, roleType: "founder", step: 1 },
      { appToken: null }
    )
  );

  assert.equal(response.status, 401);
  assert.equal(await profileRow("closed-step-cr-uid"), undefined);
});

test("the step answer's in-transaction binding re-check refuses a merge-swept actor", async () => {
  const { answerStep } = handlers({
    observeFingerprint: () => Promise.resolve({ outcome: "match" }),
  });
  await db.insert(identityFingerprints).values({
    crName: "swept-step-cr",
    mintedAt: APP_TOKEN_MINTED_AT + 100,
    userUid: "surviving-uid",
  });

  const response = await answerStep(
    await stepRequest("swept-step-cr", {
      roleOtherText: null,
      roleType: "founder",
      step: 1,
    })
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    code: "app_token_superseded",
    error: "Authentication is required.",
  });
  assert.equal(await profileRow("swept-step-cr-uid"), undefined);
});

test("both routes fail closed without the app token", async () => {
  const { dismiss, sampling } = handlers();

  const samplingResponse = await sampling(
    await samplingRequest("closed-cr", null)
  );
  assert.deepEqual(
    { body: await samplingResponse.json(), status: samplingResponse.status },
    {
      body: {
        code: "app_token_required",
        error: "Authentication is required.",
      },
      status: 401,
    }
  );

  const dismissResponse = await dismiss(
    await dismissRequest(
      "closed-cr",
      { dismissedAtStep: 1 },
      { appToken: null }
    )
  );
  assert.equal(dismissResponse.status, 401);
  assert.equal(await profileRow("closed-cr-uid"), undefined);
});

test("an app token bound to another actor is refused with 403 and writes nothing", async () => {
  const { dismiss } = handlers();

  const response = await dismiss(
    await dismissRequest(
      "victim-cr",
      { dismissedAtStep: 1 },
      { appToken: await mintAppToken("attacker-cr") }
    )
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    code: "app_token_mismatch",
    error: "App token does not match the authenticated actor.",
  });
  assert.equal(await profileRow("victim-cr-uid"), undefined);
  assert.equal(await profileRow("attacker-cr-uid"), undefined);
});

test("an app token signed with the wrong secret is refused with 401", async () => {
  const { sampling } = handlers();

  const response = await sampling(
    await samplingRequest(
      "forged-cr",
      await mintAppToken("forged-cr", "attacker-secret")
    )
  );

  assert.equal(response.status, 401);
});

test("a cross-namespace request is forbidden before any read", async () => {
  const { dismiss } = handlers();

  const response = await dismiss(
    await dismissRequest(
      "cross-ns-cr",
      { dismissedAtStep: 1 },
      { namespace: "another-workspace" }
    )
  );

  assert.equal(response.status, 403);
  assert.equal(await profileRow("cross-ns-cr-uid"), undefined);
});

test("a binding superseded at authorization time never reaches the store", async () => {
  const { dismiss } = handlers({
    observeFingerprint: () =>
      Promise.resolve({
        observedMintedAt: APP_TOKEN_MINTED_AT + 100,
        observedUserUid: "surviving-uid",
        outcome: "superseded",
      }),
  });

  const response = await dismiss(
    await dismissRequest("stale-cr", { dismissedAtStep: 1 })
  );

  assert.equal(response.status, 401);
  assert.equal(await profileRow("stale-cr-uid"), undefined);
});

test("the in-transaction binding re-check refuses a merge-swept actor with 401", async () => {
  // Authorization observes a match, but by write time the crName has been
  // re-pointed to a surviving uid — the transactional re-check must refuse.
  const { dismiss } = handlers({
    observeFingerprint: () => Promise.resolve({ outcome: "match" }),
  });
  await db.insert(identityFingerprints).values({
    crName: "swept-cr",
    mintedAt: APP_TOKEN_MINTED_AT + 100,
    userUid: "surviving-uid",
  });

  const response = await dismiss(
    await dismissRequest("swept-cr", { dismissedAtStep: 1 })
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    code: "app_token_superseded",
    error: "Authentication is required.",
  });
  assert.equal(await profileRow("swept-cr-uid"), undefined);
});
