// @ts-expect-error bun exposes mock at runtime; direct tsc in this repo lacks bun:test types.
import { mock } from "bun:test";
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { DEPLOY_TASK_ENGINE_CADENCE } from "@/features/deploy/task/engine/constants";
import type { DeployTaskEngineContext } from "@/features/deploy/task/engine/context";
import type { DeployTaskHandle } from "@/features/deploy/task/engine/handle";
import { stopDeployTaskEngineRuntimeForTests } from "@/features/deploy/task/engine/runtime";
import { insertTaskRow } from "@/features/deploy/task/engine/testing/fixtures";
import {
  createDeployTaskTestHarness,
  type DeployTaskTestHarness,
} from "@/features/deploy/task/engine/testing/harness";
import { deployTaskEvents, deployTasks } from "@/features/deploy/task/schema";

let testDb: DeployTaskTestHarness["db"] | undefined;
let testEngineContext: DeployTaskEngineContext | undefined;
let runDone: Promise<void> | undefined;
let authorizedWorkspaceActor: string | undefined = "alice-cr";
let activeGithubConnection: {
  accountLogin: string;
  accountType: string;
  id: string;
  installationId: string;
  isAuthorized: boolean;
  namespace: string;
  repositorySelection: string;
  updatedAt: string;
} | null = null;

mock.module("server-only", () => ({}));
mock.module("@/features/deploy/task/api-auth", () => ({
  deployTaskRequestParams: () => ({}),
  resolveDeployTaskRequestNamespace: async () => ({
    namespace: "namespace-b",
    ok: true as const,
    workspaceActor: authorizedWorkspaceActor,
  }),
}));
mock.module("@/features/deploy/github/connection-service", () => ({
  getGithubConnectionStatusForWorkspaceActor: async () =>
    activeGithubConnection,
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
mock.module("@/features/deploy/task/engine/server", () => ({
  getDeployTaskEngineContext: () => {
    assert.ok(testEngineContext);
    return testEngineContext;
  },
}));
mock.module("@/features/deploy/task/runner", () => ({
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
  activeGithubConnection = null;
  authorizedWorkspaceActor = "alice-cr";
  runDone = undefined;
  testDb = undefined;
  testEngineContext = undefined;
  stopDeployTaskEngineRuntimeForTests();
}

function githubConnection(id: string, accountLogin: string) {
  return {
    accountLogin,
    accountType: "User",
    id,
    installationId: "",
    isAuthorized: true,
    namespace: "namespace-b",
    repositorySelection: "oauth",
    updatedAt: new Date(0).toISOString(),
  };
}

function githubCreateBody(overrides: Record<string, unknown> = {}) {
  return {
    namespace: "namespace-b",
    runner: { kind: "ai", runtimeProvider: "devbox" },
    source: {
      kind: "github",
      repo: {
        fullName: "alice/example",
        name: "example",
        url: "https://github.com/alice/example",
      },
    },
    target: { kind: "existingProject", projectId: "project-test" },
    ...overrides,
  };
}

test("POST binds GitHub creation to the verified actor's active connection", async () => {
  const harness = await createDeployTaskTestHarness();
  useHarness(harness);
  activeGithubConnection = githubConnection("connection-alice", "alice");
  try {
    const { POST } = await import("./route");
    const response = await POST(
      new Request("https://brain.test/api/deploy-tasks", {
        body: JSON.stringify(
          githubCreateBody({
            actorUserId: "foreign-desktop-user",
            githubConnectionId: "connection-alice",
            githubToken: "oauth-token-must-not-be-audited",
          })
        ),
        headers: { "content-type": "application/json" },
        method: "POST",
      })
    );
    const body = (await response.json()) as {
      task: {
        creatingActor: string;
        credentialBinding: unknown;
        id: string;
      };
    };

    assert.equal(response.status, 201);
    assert.equal(body.task.creatingActor, "alice-cr");
    assert.deepEqual(body.task.credentialBinding, {
      connectionRef: "connection-alice",
      credentialOwner: "alice-cr",
      version: 1,
    });
    const [stored] = await harness.db
      .select()
      .from(deployTasks)
      .where(eq(deployTasks.id, body.task.id));
    assert.equal(stored?.creatingActor, "alice-cr");
    assert.deepEqual(stored?.credentialBinding, body.task.credentialBinding);
    const events = await harness.db
      .select()
      .from(deployTaskEvents)
      .where(eq(deployTaskEvents.taskId, body.task.id));
    assert.equal(
      events.find((event) => event.kind === "deploy_task.created")?.payload
        .actionActor,
      "alice-cr"
    );
    assert.ok(
      !JSON.stringify(events).includes("oauth-token-must-not-be-audited")
    );
    await runDone;
  } finally {
    clearHarness();
    await harness.close();
  }
});

test("GET records a shared-task inspection by the verified action actor", async () => {
  const harness = await createDeployTaskTestHarness();
  useHarness(harness);
  authorizedWorkspaceActor = "bob-cr";
  try {
    const task = await insertTaskRow(harness.db, {
      creatingActor: "alice-cr",
      credentialBinding: {
        connectionRef: "connection-alice",
        credentialOwner: "alice-cr",
        version: 1,
      },
      namespace: "namespace-b",
      source: githubCreateBody().source as never,
    });
    const { GET } = await import("./[taskId]/route");
    const response = await GET(
      new Request(`https://brain.test/api/deploy-tasks/${task.id}`),
      { params: Promise.resolve({ taskId: task.id }) }
    );

    assert.equal(response.status, 200);
    const events = await harness.db
      .select()
      .from(deployTaskEvents)
      .where(eq(deployTaskEvents.taskId, task.id));
    assert.equal(
      events.find((event) => event.kind === "deployment_task.inspected")
        ?.payload.actionActor,
      "bob-cr"
    );
    const [unchanged] = await harness.db
      .select()
      .from(deployTasks)
      .where(eq(deployTasks.id, task.id));
    assert.deepEqual(unchanged?.credentialBinding, task.credentialBinding);
  } finally {
    clearHarness();
    await harness.close();
  }
});

test("POST rejects a client-selected foreign GitHub connection", async () => {
  const harness = await createDeployTaskTestHarness();
  useHarness(harness);
  activeGithubConnection = githubConnection("connection-alice", "alice");
  try {
    const { POST } = await import("./route");
    const response = await POST(
      new Request("https://brain.test/api/deploy-tasks", {
        body: JSON.stringify(
          githubCreateBody({ githubConnectionId: "connection-bob" })
        ),
        headers: { "content-type": "application/json" },
        method: "POST",
      })
    );

    assert.deepEqual(
      { body: await response.json(), status: response.status },
      {
        body: {
          code: "github_connection_forbidden",
          error:
            "The selected GitHub connection is not owned by the verified actor.",
        },
        status: 403,
      }
    );
    assert.equal((await harness.db.select().from(deployTasks)).length, 0);
  } finally {
    clearHarness();
    await harness.close();
  }
});

test("POST requires the verified actor's active GitHub connection before creating a task", async () => {
  const harness = await createDeployTaskTestHarness();
  useHarness(harness);
  try {
    const { POST } = await import("./route");
    const response = await POST(
      new Request("https://brain.test/api/deploy-tasks", {
        body: JSON.stringify(githubCreateBody()),
        headers: { "content-type": "application/json" },
        method: "POST",
      })
    );

    assert.deepEqual(
      { body: await response.json(), status: response.status },
      {
        body: {
          code: "github_connection_required",
          error: "Connect GitHub before creating this deployment task.",
        },
        status: 409,
      }
    );
    assert.equal((await harness.db.select().from(deployTasks)).length, 0);
  } finally {
    clearHarness();
    await harness.close();
  }
});

test("POST rejects GitHub creation without a verified Workspace Actor", async () => {
  const harness = await createDeployTaskTestHarness();
  useHarness(harness);
  authorizedWorkspaceActor = undefined;
  try {
    const { POST } = await import("./route");
    const response = await POST(
      new Request("https://brain.test/api/deploy-tasks", {
        body: JSON.stringify(githubCreateBody()),
        headers: { "content-type": "application/json" },
        method: "POST",
      })
    );

    assert.deepEqual(
      { body: await response.json(), status: response.status },
      {
        body: {
          code: "workspace_actor_required",
          error:
            "A verified Workspace Actor is required for GitHub deployment.",
        },
        status: 403,
      }
    );
    assert.equal((await harness.db.select().from(deployTasks)).length, 0);
  } finally {
    clearHarness();
    await harness.close();
  }
});

test("POST redeploy binds the new task to the initiator and leaves its predecessor unchanged", async () => {
  const harness = await createDeployTaskTestHarness();
  useHarness(harness);
  authorizedWorkspaceActor = "bob-cr";
  activeGithubConnection = githubConnection("connection-bob", "bob");
  try {
    const predecessor = await insertTaskRow(harness.db, {
      artifactSummary: {
        resultIdentities: { templateInstanceName: "preserved-result" },
      },
      completedAt: new Date(),
      creatingActor: "alice-cr",
      credentialBinding: {
        connectionRef: "connection-alice",
        credentialOwner: "alice-cr",
        version: 1,
      },
      namespace: "namespace-b",
      source: githubCreateBody().source as never,
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
        creatingActor: string;
        credentialBinding: unknown;
        id: string;
        retriedFromTaskId: string;
      };
    };
    await runDone;

    assert.equal(response.status, 201);
    assert.equal(body.task.creatingActor, "bob-cr");
    assert.deepEqual(body.task.credentialBinding, {
      connectionRef: "connection-bob",
      credentialOwner: "bob-cr",
      version: 1,
    });
    assert.equal(body.task.retriedFromTaskId, predecessor.id);
    const [clone] = await harness.db
      .select()
      .from(deployTasks)
      .where(eq(deployTasks.id, body.task.id));
    assert.deepEqual(clone?.source, predecessor.source);
    assert.deepEqual(clone?.target, predecessor.target);
    assert.deepEqual(clone?.artifactSummary.resultIdentities, {
      templateInstanceName: "preserved-result",
    });
    const cloneEvents = await harness.db
      .select()
      .from(deployTaskEvents)
      .where(eq(deployTaskEvents.taskId, body.task.id));
    assert.equal(
      cloneEvents.find((event) => event.kind === "deploy_task.created")?.payload
        .actionActor,
      "bob-cr"
    );
    const [unchangedPredecessor] = await harness.db
      .select()
      .from(deployTasks)
      .where(eq(deployTasks.id, predecessor.id));
    assert.equal(unchangedPredecessor?.creatingActor, "alice-cr");
    assert.deepEqual(unchangedPredecessor?.credentialBinding, {
      connectionRef: "connection-alice",
      credentialOwner: "alice-cr",
      version: 1,
    });
  } finally {
    clearHarness();
    await harness.close();
  }
});

test("POST redeploy creates no task without the initiator's own GitHub connection", async () => {
  const harness = await createDeployTaskTestHarness();
  useHarness(harness);
  authorizedWorkspaceActor = "bob-cr";
  try {
    const predecessor = await insertTaskRow(harness.db, {
      completedAt: new Date(),
      creatingActor: "alice-cr",
      credentialBinding: {
        connectionRef: "connection-alice",
        credentialOwner: "alice-cr",
        version: 1,
      },
      namespace: "namespace-b",
      source: githubCreateBody().source as never,
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

    assert.deepEqual(
      { body: await response.json(), status: response.status },
      {
        body: {
          code: "github_connection_required",
          error: "Connect GitHub before creating this deployment task.",
        },
        status: 409,
      }
    );
    assert.deepEqual(
      (await harness.db.select().from(deployTasks)).map((task) => task.id),
      [predecessor.id]
    );
  } finally {
    clearHarness();
    await harness.close();
  }
});

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
