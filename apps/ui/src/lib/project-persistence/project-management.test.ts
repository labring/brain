import { mock } from "bun:test";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";

import {
  createDeployTaskTestHarness,
  type DeployTaskTestHarness,
} from "@/features/deploy/task/engine/testing/harness";

import type { ProjectPgDatabase } from "./db";
import { projectDeletePreviews, projects } from "./schema";

mock.module("server-only", () => ({}));

let harness: DeployTaskTestHarness;
let projectDb: ProjectPgDatabase | undefined;

mock.module(fileURLToPath(new URL("./db.ts", import.meta.url)), () => ({
  getProjectDb: () => {
    assert.ok(projectDb);
    return projectDb;
  },
}));

const {
  deleteManagedProject,
  previewManagedProjectDeletion,
  resourceSummaryFingerprint,
} = await import("./project-management");

before(async () => {
  harness = await createDeployTaskTestHarness();
  projectDb = harness.db as unknown as ProjectPgDatabase;
});

after(async () => {
  await harness.close();
});

test("resource summary fingerprints ignore object key order", () => {
  const summary = {
    ap: ["api"],
    db: [],
    template: ["template"],
    templateCertificates: [],
    templateClusters: [],
    templateConfigMaps: [],
    templateDeployments: [],
    templateIngresses: [],
    templateIssuers: [],
    templateJobs: [],
    templateOpsRequests: [],
    templatePersistentVolumeClaims: [],
    templatePods: [],
    templateSecrets: [],
    templateServices: [],
    templateStatefulSets: [],
  };
  const reordered = Object.fromEntries(
    Object.entries(summary).reverse()
  ) as typeof summary;
  assert.equal(
    resourceSummaryFingerprint(summary),
    resourceSummaryFingerprint(reordered)
  );
});

test("valid preview deletes without model-provided resource details", async () => {
  assert.ok(projectDb);
  const namespace = "ns-preview";
  const projectId = "project-preview";
  const now = new Date("2026-08-03T00:00:00.000Z");
  await projectDb.insert(projects).values({
    createdAt: now,
    description: "",
    displayName: "Preview Project",
    id: projectId,
    namespace,
    updatedAt: now,
  });

  const originalApiUrl = process.env.API_URL;
  const originalFetch = globalThis.fetch;
  process.env.API_URL = "https://brain.test";
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(JSON.stringify({ items: [] }), { status: 200 })
    )) as unknown as typeof fetch;

  try {
    const actor = {
      actorUid: "user-1",
      chatId: "chat-1",
      encodedKubeconfig: "kubeconfig",
      namespace,
    };
    const preview = await previewManagedProjectDeletion(actor, projectId);
    assert.ok(preview);

    const invalid = await deleteManagedProject({
      actor: { ...actor, chatId: "other-chat" },
      previewId: preview.previewId,
      projectId,
    });
    assert.deepEqual(invalid, { code: "invalid_preview", ok: false });

    const [afterInvalid] = await projectDb
      .select({ consumedAt: projectDeletePreviews.consumedAt })
      .from(projectDeletePreviews)
      .where(eq(projectDeletePreviews.id, preview.previewId));
    assert.equal(afterInvalid?.consumedAt, null);

    const deleted = await deleteManagedProject({
      actor,
      previewId: preview.previewId,
      projectId,
    });
    assert.equal(deleted.ok, true);

    const [afterDelete] = await projectDb
      .select({ consumedAt: projectDeletePreviews.consumedAt })
      .from(projectDeletePreviews)
      .where(eq(projectDeletePreviews.id, preview.previewId));
    assert.ok(afterDelete?.consumedAt instanceof Date);

    const remainingProjects = await projectDb
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId));
    assert.deepEqual(remainingProjects, []);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiUrl === undefined) {
      delete process.env.API_URL;
    } else {
      process.env.API_URL = originalApiUrl;
    }
  }
});
