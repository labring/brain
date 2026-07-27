import { mock } from "bun:test";
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { asc } from "drizzle-orm";
import { DEPLOY_TASK_ENGINE_CADENCE } from "@/features/deploy/task/engine/constants";
import type { DeployTaskEngineContext } from "@/features/deploy/task/engine/context";
import type { DeployTaskHandle } from "@/features/deploy/task/engine/handle";
import { stopDeployTaskEngineRuntimeForTests } from "@/features/deploy/task/engine/runtime";
import {
  createDeployTaskTestHarness,
  type DeployTaskTestHarness,
} from "@/features/deploy/task/engine/testing/harness";
import { projects } from "@/lib/project-persistence/schema";

/**
 * Project naming at the highest seam there is: a creation request in, a
 * persisted Project name out, over the real drizzle migrations — so the
 * `(namespace, lower(display_name))` unique index, not a mock, is what decides
 * every collision (ADR 0058).
 */

const NAMESPACE = "namespace-b";
const RANDOM_DISPLAY_NAME_RE = /^[a-z]+-[a-z]+$/;

let testDb: DeployTaskTestHarness["db"] | undefined;
let testEngineContext: DeployTaskEngineContext | undefined;
let pendingRuns: Promise<void>[] = [];

mock.module("server-only", () => ({}));
mock.module("@/features/deploy/task/api-auth", () => ({
  deployTaskRequestParams: () => ({}),
  resolveDeployTaskRequestNamespace: async () => ({
    namespace: NAMESPACE,
    ok: true as const,
    workspaceActor: "alice-cr",
  }),
}));
mock.module(
  fileURLToPath(
    new URL("../../../features/deploy/task/db.ts", import.meta.url)
  ),
  () => ({
    getDeploymentTaskDb: () => {
      assert.ok(testDb);
      return testDb;
    },
  })
);
mock.module(
  fileURLToPath(
    new URL("../../../lib/project-persistence/db.ts", import.meta.url)
  ),
  () => ({
    getProjectDb: () => {
      assert.ok(testDb);
      return testDb;
    },
  })
);
mock.module("@/features/deploy/task/engine/server", () => ({
  getDeployTaskEngineContext: () => {
    assert.ok(testEngineContext);
    return testEngineContext;
  },
}));

// Only the run is stubbed: target resolution stays real, because the naming
// rules under test live behind it.
const runnerModulePath = fileURLToPath(
  new URL("../../../features/deploy/task/runner.ts", import.meta.url)
);
const actualRunner = await import("@/features/deploy/task/runner");
mock.module(runnerModulePath, () => ({
  ...actualRunner,
  runDeployTask: (handle: DeployTaskHandle) => {
    const run = (async () => {
      await handle.beginApplying();
      await handle.complete();
    })();
    pendingRuns.push(run);
    return run;
  },
}));

function useHarness(harness: DeployTaskTestHarness): void {
  testDb = harness.db;
  testEngineContext = {
    cadence: DEPLOY_TASK_ENGINE_CADENCE,
    db: harness.db as unknown as DeployTaskEngineContext["db"],
    devbox: {
      deleteDevbox: async () => "missing",
      pauseDevbox: async () => "missing",
    },
    notify: harness.notify,
    processId: "deploy-task-naming-test",
  };
}

async function clearHarness(): Promise<void> {
  await Promise.all(pendingRuns);
  pendingRuns = [];
  testDb = undefined;
  testEngineContext = undefined;
  stopDeployTaskEngineRuntimeForTests();
}

function dockerSource(image: string) {
  return {
    kind: "docker",
    settings: { appListeningPort: 8080, env: [], image },
  };
}

async function createDeployTask(body: Record<string, unknown>) {
  const { POST } = await import("./route");
  const response = await POST(
    new Request("https://brain.test/api/deploy-tasks", {
      body: JSON.stringify({
        namespace: NAMESPACE,
        runner: { kind: "direct" },
        ...body,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  return {
    body: (await response.json()) as {
      error?: string;
      task?: { id: string; projectId: string | null };
    },
    status: response.status,
  };
}

async function displayNames(harness: DeployTaskTestHarness): Promise<string[]> {
  const rows = await harness.db
    .select({ displayName: projects.displayName })
    .from(projects)
    .orderBy(asc(projects.createdAt));
  return rows.map((row) => row.displayName);
}

test("an unnamed new Project takes its name from the Deployment Source", async () => {
  const harness = await createDeployTaskTestHarness();
  useHarness(harness);
  try {
    const created = await createDeployTask({
      source: dockerSource("ghcr.io/acme/nginx:1.27"),
      target: { kind: "newProject" },
    });

    assert.equal(created.status, 201);
    assert.deepEqual(await displayNames(harness), ["nginx"]);
  } finally {
    await clearHarness();
    await harness.close();
  }
});

test("repeat deployments of the same source get incrementing suffixes", async () => {
  const harness = await createDeployTaskTestHarness();
  useHarness(harness);
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const created = await createDeployTask({
        source: dockerSource("nginx:1.27"),
        target: { kind: "newProject" },
      });
      assert.equal(created.status, 201);
    }

    assert.deepEqual(await displayNames(harness), [
      "nginx",
      "nginx-2",
      "nginx-3",
    ]);
  } finally {
    await clearHarness();
    await harness.close();
  }
});

test("simultaneous creates from one source all succeed with distinct names", async () => {
  const harness = await createDeployTaskTestHarness();
  useHarness(harness);
  try {
    const created = await Promise.all(
      Array.from({ length: 3 }, () =>
        createDeployTask({
          source: dockerSource("nginx:1.27"),
          target: { kind: "newProject" },
        })
      )
    );

    // No create loses the race: the index arbitrates, so a name already taken
    // just bumps the loser's suffix.
    assert.deepEqual(
      created.map((response) => response.status),
      [201, 201, 201]
    );
    const names = await displayNames(harness);
    assert.deepEqual([...names].sort(), ["nginx", "nginx-2", "nginx-3"]);
  } finally {
    await clearHarness();
    await harness.close();
  }
});

test("a case variant of a taken name is suffixed, not left indistinguishable", async () => {
  const harness = await createDeployTaskTestHarness();
  useHarness(harness);
  try {
    await createDeployTask({
      source: dockerSource("nginx:1.27"),
      target: { kind: "newProject" },
    });
    const created = await createDeployTask({
      runner: { kind: "template" },
      source: { kind: "template", templateName: "Nginx" },
      target: { kind: "newProject" },
    });

    assert.equal(created.status, 201);
    assert.deepEqual(await displayNames(harness), ["nginx", "Nginx-2"]);
  } finally {
    await clearHarness();
    await harness.close();
  }
});

test("a caller-chosen name is used verbatim", async () => {
  const harness = await createDeployTaskTestHarness();
  useHarness(harness);
  try {
    const created = await createDeployTask({
      source: dockerSource("ghcr.io/acme/nginx:1.27"),
      target: { displayName: "Order Traffic", kind: "newProject" },
    });

    assert.equal(created.status, 201);
    assert.deepEqual(await displayNames(harness), ["Order Traffic"]);
  } finally {
    await clearHarness();
    await harness.close();
  }
});

test("a caller-chosen name that is taken is a conflict, never a silent rename", async () => {
  const harness = await createDeployTaskTestHarness();
  useHarness(harness);
  try {
    await createDeployTask({
      source: dockerSource("nginx:1.27"),
      target: { displayName: "orders", kind: "newProject" },
    });
    const conflict = await createDeployTask({
      source: dockerSource("nginx:1.27"),
      target: { displayName: "Orders", kind: "newProject" },
    });

    assert.equal(conflict.status, 409);
    assert.equal(
      conflict.body.error,
      'A project named "Orders" already exists.'
    );
    assert.deepEqual(await displayNames(harness), ["orders"]);
    // The rejected request left no half-created Deployment Task behind.
    assert.equal((await harness.db.query.deployTasks.findMany()).length, 1);
  } finally {
    await clearHarness();
    await harness.close();
  }
});

test("a source with no usable name still yields a readable Project name", async () => {
  const harness = await createDeployTaskTestHarness();
  useHarness(harness);
  try {
    const created = await createDeployTask({
      runner: { kind: "ai", runtimeProvider: "devbox" },
      source: { kind: "prompt", text: "deploy something for me" },
      target: { kind: "newProject" },
    });

    assert.equal(created.status, 201);
    const [displayName] = await displayNames(harness);
    assert.match(displayName ?? "", RANDOM_DISPLAY_NAME_RE);
  } finally {
    await clearHarness();
    await harness.close();
  }
});
