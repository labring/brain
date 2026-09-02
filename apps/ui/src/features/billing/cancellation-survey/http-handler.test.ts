import { afterAll, beforeEach, test } from "bun:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import type { WorkspaceActorAuthorization } from "@/lib/request-kubeconfig-auth";

import { createCancellationSurveyHandler } from "./http-handler";
import { cancellationSurveyResponses } from "./schema";
import { createCancellationSurveyStore } from "./store";

const pglite = new PGlite();
const db = drizzle(pglite, { schema: { cancellationSurveyResponses } });
await migrate(db, {
  migrationsFolder: path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../drizzle"
  ),
});

const store = createCancellationSurveyStore(() => db);

afterAll(() => pglite.close());

beforeEach(async () => {
  await db.delete(cancellationSurveyResponses);
});

const VERIFIED_ACTOR = {
  actorBinding: {
    crName: "alice-cr",
    mintedAt: 1_753_600_000,
    userId: "user-alice",
    userUid: "uid-alice",
  },
  namespace: "workspace-a",
  ok: true,
  workspaceActor: "alice-cr",
} satisfies WorkspaceActorAuthorization;

const REJECTED_ACTOR = {
  code: "app_token_required",
  message: "App token missing.",
  ok: false,
  status: 401,
} satisfies WorkspaceActorAuthorization;

function surveyRequest(body: unknown): Request {
  return new Request(
    "https://brain.example.test/api/billing/subscription/cancellation-survey",
    {
      body: JSON.stringify(body),
      headers: {
        Authorization: "Bearer encoded-kubeconfig",
        "Content-Type": "application/json",
        "X-Sealos-App-Token": "desktop-app-token",
      },
      method: "POST",
    }
  );
}

const VALID_BODY = {
  currentPeriodEndAt: "2026-08-31T00:00:00Z",
  feedback: "  Too pricey for a side project.  ",
  planName: "Pro",
  reasons: ["too_expensive", "low_usage"],
  regionDomain: "us.example.test",
  workspace: "workspace-a",
};

function handler(authorization: WorkspaceActorAuthorization = VERIFIED_ACTOR) {
  return createCancellationSurveyHandler({
    authorizeWorkspaceActor: () => Promise.resolve(authorization),
    record: store.record,
  });
}

test("a valid response lands as one row keyed by the verified actor's uid", async () => {
  const response = await handler()(surveyRequest(VALID_BODY));
  assert.equal(response.status, 200);
  const payload = (await response.json()) as { id: string; ok: boolean };
  assert.equal(payload.ok, true);

  const rows = await db.select().from(cancellationSurveyResponses);
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row?.id, payload.id);
  assert.equal(row?.workspace, "workspace-a");
  assert.equal(row?.regionDomain, "us.example.test");
  assert.equal(row?.planName, "Pro");
  assert.equal(
    row?.currentPeriodEndAt?.toISOString(),
    "2026-08-31T00:00:00.000Z"
  );
  assert.equal(row?.userUid, "uid-alice");
  assert.deepEqual(row?.reasonKeys, ["too_expensive", "low_usage"]);
  assert.equal(row?.feedback, "Too pricey for a side project.");
  assert.ok(row?.createdAt instanceof Date);
});

test("an unanswered survey still lands as a row", async () => {
  const response = await handler()(
    surveyRequest({
      ...VALID_BODY,
      currentPeriodEndAt: null,
      feedback: "",
      reasons: [],
    })
  );
  assert.equal(response.status, 200);

  const rows = await db.select().from(cancellationSurveyResponses);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0]?.reasonKeys, []);
  assert.equal(rows[0]?.feedback, "");
  assert.equal(rows[0]?.currentPeriodEndAt, null);
});

test("unknown reason keys, duplicates, over-length text, and blank scope are rejected", async () => {
  const invalidBodies: unknown[] = [
    { ...VALID_BODY, reasons: ["churned_hard"] },
    { ...VALID_BODY, reasons: ["other", "other"] },
    { ...VALID_BODY, feedback: "x".repeat(501) },
    { ...VALID_BODY, workspace: "  " },
    { ...VALID_BODY, regionDomain: "" },
    { ...VALID_BODY, planName: "" },
    null,
  ];
  for (const body of invalidBodies) {
    const response = await handler()(surveyRequest(body));
    assert.equal(response.status, 400, JSON.stringify(body)?.slice(0, 60));
  }
  assert.equal((await db.select().from(cancellationSurveyResponses)).length, 0);
});

test("text of exactly the maximum length is accepted after trimming", async () => {
  const response = await handler()(
    surveyRequest({ ...VALID_BODY, feedback: `  ${"y".repeat(500)}  ` })
  );
  assert.equal(response.status, 200);
  const rows = await db.select().from(cancellationSurveyResponses);
  assert.equal(rows[0]?.feedback.length, 500);
});

test("a response for another workspace than the verified one is refused", async () => {
  const response = await handler()(
    surveyRequest({ ...VALID_BODY, workspace: "workspace-b" })
  );
  assert.equal(response.status, 403);
  assert.equal((await db.select().from(cancellationSurveyResponses)).length, 0);
});

test("authorization failure fails closed and writes nothing", async () => {
  const response = await handler(REJECTED_ACTOR)(surveyRequest(VALID_BODY));
  assert.equal(response.status, 401);
  assert.equal((await db.select().from(cancellationSurveyResponses)).length, 0);
});

test("a persistence failure answers 503 without leaking details", async () => {
  const failing = createCancellationSurveyHandler({
    authorizeWorkspaceActor: () => Promise.resolve(VERIFIED_ACTOR),
    record: () => Promise.reject(new Error("connection refused")),
  });
  const response = await failing(surveyRequest(VALID_BODY));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: "Cancellation survey persistence is unavailable.",
  });
});
