// @ts-expect-error bun exposes mock at runtime; direct tsc in this repo lacks bun:test types.
import { mock } from "bun:test";
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { DEPLOY_TASK_ENGINE_CADENCE } from "@/lib/deploy-task/engine/constants";
import type { DeployTaskEngineContext } from "@/lib/deploy-task/engine/context";
import type { DeployTaskHandle } from "@/lib/deploy-task/engine/handle";
import { stopDeployTaskEngineRuntimeForTests } from "@/lib/deploy-task/engine/runtime";
import { insertTaskRow } from "@/lib/deploy-task/engine/testing/fixtures";
import {
  createDeployTaskTestHarness,
  type DeployTaskTestHarness,
} from "@/lib/deploy-task/engine/testing/harness";

let testDb: DeployTaskTestHarness["db"] | undefined;
let testEngineContext: DeployTaskEngineContext | undefined;
let runDone: Promise<void> | undefined;

mock.module("server-only", () => ({}));
mock.module("@/lib/deploy-task/api-auth", () => ({
  deployTaskRequestParams: () => ({}),
  resolveDeployTaskRequestNamespace: async () => ({
    namespace: "namespace-b",
    ok: true as const,
  }),
}));
mock.module(
  fileURLToPath(new URL("../../../lib/deploy-task/db.ts", import.meta.url)),
  () => ({
    getDeploymentTaskDb: () => {
      assert.ok(testDb);
      return testDb;
    },
  })
);
mock.module("@/lib/deploy-task/engine/server", () => ({
  getDeployTaskEngineContext: () => {
    assert.ok(testEngineContext);
    return testEngineContext;
  },
}));
mock.module("@/lib/deploy-task/runner", () => ({
  resolveDeploymentTaskTarget: async () => ({
    projectId: "project-test",
    projectName: "Project Test",
  }),
  runDeployTask: (handle: DeployTaskHandle) => {
    runDone = (async () => {
      await handle.beginApplying();
      await handle.complete();
    })();
    return runDone;
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
    processId: "deploy-task-route-test",
  };
}

function clearHarness(): void {
  runDone = undefined;
  testDb = undefined;
  testEngineContext = undefined;
  stopDeployTaskEngineRuntimeForTests();
}

test("POST creates a redeploy from a predecessor in the authorized namespace", async () => {
  const harness = await createDeployTaskTestHarness();
  useHarness(harness);
  try {
    const predecessor = await insertTaskRow(harness.db, {
      completedAt: new Date(),
      namespace: "namespace-b",
      source: { kind: "template", templateName: "authorized-source" },
      status: "failed",
    });
    const { POST } = await import("./route");

    const response = await POST(
      new Request("https://brain.test/api/deploy-tasks", {
        body: JSON.stringify({
          namespace: "namespace-b",
          predecessorTaskId: predecessor.id,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      })
    );
    const body = (await response.json()) as {
      task: {
        namespace: string;
        retriedFromTaskId: string;
        source: unknown;
      };
    };
    assert.ok(runDone);
    await runDone;

    assert.deepEqual(
      {
        namespace: body.task.namespace,
        retriedFromTaskId: body.task.retriedFromTaskId,
        source: body.task.source,
        status: response.status,
      },
      {
        namespace: "namespace-b",
        retriedFromTaskId: predecessor.id,
        source: { kind: "template", templateName: "authorized-source" },
        status: 201,
      }
    );
  } finally {
    clearHarness();
    await harness.close();
  }
});

test("POST uniformly hides predecessors from another namespace before validating redeploy fields", async () => {
  const harness = await createDeployTaskTestHarness();
  useHarness(harness);
  try {
    const { POST } = await import("./route");

    for (const status of [
      "failed",
      "cancelled",
      "running",
      "completed",
    ] as const) {
      const predecessor = await insertTaskRow(harness.db, {
        completedAt: status === "running" ? null : new Date(),
        namespace: "namespace-a",
        status,
      });
      const response = await POST(
        new Request("https://brain.test/api/deploy-tasks", {
          body: JSON.stringify({
            namespace: "namespace-b",
            predecessorTaskId: predecessor.id,
            source: {
              branch: "main",
              kind: "github",
              repo: {
                fullName: "namespace-a/private-repo",
                name: "private-repo",
                url: "https://github.com/namespace-a/private-repo",
              },
            },
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        })
      );

      assert.deepEqual(
        { body: await response.json(), status: response.status },
        {
          body: { error: "Deploy task predecessor not found" },
          status: 404,
        }
      );
    }
  } finally {
    clearHarness();
    await harness.close();
  }
});
