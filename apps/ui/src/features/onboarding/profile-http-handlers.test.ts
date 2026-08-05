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

function handlers(
  overrides: Partial<OnboardingProfileHandlerDependencies> = {}
) {
  return createOnboardingProfileHandlers({
    appTokenConfig: APP_TOKEN_CONFIG,
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
