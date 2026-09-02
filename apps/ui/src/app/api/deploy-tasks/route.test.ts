import { mock } from "bun:test";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { identityFingerprints } from "@/features/chat/persistence/schema";
import type {
  GithubConnectionOwnerIdentity,
  VerifiedGithubConnectionActor,
} from "@/features/deploy/github/owner-identity";
import { redeployDeploymentTask } from "@/features/deploy/task/client";
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

// Snapshot before mock.module: a live namespace import would resolve to the
// mock itself and the fall-through below would recurse forever.
const actualRequestKubeconfigAuth = {
  ...(await import("@/lib/request-kubeconfig-auth")),
};

let testDb: DeployTaskTestHarness["db"] | undefined;
let testEngineContext: DeployTaskEngineContext | undefined;
let runDone: Promise<void> | undefined;
let authorizedWorkspaceActor: string | undefined = "alice-cr";
let afterAuthorize: (() => Promise<void>) | undefined;
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

/**
 * The app-token-proven crName → userUid bindings (ADR-0059). The formats are
 * deliberately disjoint: a crName never equals a uid.
 */
const USER_UIDS: Record<string, string> = {
  "alice-cr": "uid-alice",
  "bob-cr": "uid-bob",
};
const AUTHORIZED_ENCODED_KUBECONFIG = "encoded-kubeconfig-test";
const APP_TOKENS: Record<string, string> = {
  "app-token-alice": "alice-cr",
  "app-token-bob": "bob-cr",
};

let authorizeCalls: {
  appToken: string | undefined;
  encodedKubeconfig: string | undefined;
  expectedNamespace: string | undefined;
}[] = [];
let adoptionCalls: VerifiedGithubConnectionActor[] = [];
let connectionLookups: GithubConnectionOwnerIdentity[] = [];

mock.module("server-only", () => ({}));

// Snapshot after the server-only mock (the module imports it) and before the
// module mock below, for the same no-self-recursion reason as above. The
// fall-through keeps the real behavior for other test files in a shared
// bun test process, where mock.module leaks across files.
const actualConnectionService = {
  ...(await import("@/features/deploy/github/connection-service")),
};

// Snapshot the real runner before mocking it below, so the runner mock can be
// restored once this file's tests finish — the runner is itself under test in
// src/features/deploy/task/runner.template-preserve.test.ts, which runs later
// in the same bun test process and must see the real runDeployTask.
const actualRunner = {
  ...(await import("@/features/deploy/task/runner")),
};

after(() => {
  mock.module("@/features/deploy/task/runner", () => ({ ...actualRunner }));
});

mock.module("@/features/deploy/task/api-auth", () => ({
  deployTaskRequestParams: () => ({}),
  resolveDeployTaskRequestNamespace: async () => ({
    namespace: "namespace-b",
    ok: true as const,
    workspaceActor: authorizedWorkspaceActor,
  }),
}));
mock.module("@/lib/request-kubeconfig-auth", () => ({
  ...actualRequestKubeconfigAuth,
  /**
   * Mirrors the real choke point's fail-closed contract (ADR-0059) for the
   * test kubeconfig so route tests prove the header value reaches the
   * authorization input; anything else falls through to the real function.
   */
  authorizeWorkspaceActor: async (
    input: Parameters<
      typeof actualRequestKubeconfigAuth.authorizeWorkspaceActor
    >[0]
  ) => {
    if (input.encodedKubeconfig !== AUTHORIZED_ENCODED_KUBECONFIG) {
      return await actualRequestKubeconfigAuth.authorizeWorkspaceActor(input);
    }
    authorizeCalls.push({
      appToken: input.appToken,
      encodedKubeconfig: input.encodedKubeconfig,
      expectedNamespace: input.expectedNamespace,
    });
    if (authorizedWorkspaceActor == null) {
      return {
        code: "workspace_actor_required" as const,
        message: "A verified Workspace Actor is required.",
        ok: false as const,
        status: 403,
      };
    }
    const tokenActor = APP_TOKENS[input.appToken ?? ""];
    if (tokenActor == null) {
      return {
        code: "app_token_required" as const,
        message: "Authentication is required.",
        ok: false as const,
        status: 401,
      };
    }
    if (tokenActor !== authorizedWorkspaceActor) {
      return {
        code: "app_token_mismatch" as const,
        message: "App token does not match the authenticated actor.",
        ok: false as const,
        status: 403,
      };
    }
    assert.ok(testDb);
    const userUid = USER_UIDS[authorizedWorkspaceActor] ?? "uid-unknown";
    await testDb
      .insert(identityFingerprints)
      .values({
        crName: authorizedWorkspaceActor,
        mintedAt: 1,
        userUid,
      })
      .onConflictDoUpdate({
        set: { mintedAt: 1, userUid },
        target: identityFingerprints.crName,
      });
    await afterAuthorize?.();
    return {
      actorBinding: {
        crName: authorizedWorkspaceActor,
        mintedAt: null,
        userUid,
      },
      namespace: "namespace-b",
      ok: true as const,
      workspaceActor: authorizedWorkspaceActor,
    };
  },
}));
mock.module("@/features/deploy/github/connection-service", () => ({
  ...actualConnectionService,
  adoptLegacyGithubConnectionForOwner: (
    actor: VerifiedGithubConnectionActor
  ) => {
    if (actor.owner.namespace !== "namespace-b") {
      return actualConnectionService.adoptLegacyGithubConnectionForOwner(actor);
    }
    adoptionCalls.push(actor);
    return Promise.resolve();
  },
  getGithubConnectionStatusForOwner: (owner: GithubConnectionOwnerIdentity) => {
    if (owner.namespace !== "namespace-b") {
      return actualConnectionService.getGithubConnectionStatusForOwner(owner);
    }
    connectionLookups.push(owner);
    return Promise.resolve(activeGithubConnection);
  },
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
  resolveDeployTaskTargetForCreate: async () => ({
    kind: "resolved",
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
  adoptionCalls = [];
  afterAuthorize = undefined;
  authorizeCalls = [];
  authorizedWorkspaceActor = "alice-cr";
  connectionLookups = [];
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
    encodedKubeconfig: AUTHORIZED_ENCODED_KUBECONFIG,
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

function deployTaskRequest(
  body: Record<string, unknown>,
  appToken?: string
): Request {
  return new Request("https://brain.test/api/deploy-tasks", {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      ...(appToken == null ? {} : { "X-Sealos-App-Token": appToken }),
    },
    method: "POST",
  });
}

test("POST binds GitHub creation to the initiator's uid-keyed active connection", async () => {
  const harness = await createDeployTaskTestHarness();
  useHarness(harness);
  activeGithubConnection = githubConnection("connection-alice", "alice");
  try {
    const { POST } = await import("./route");
    const response = await POST(
      deployTaskRequest(
        githubCreateBody({
          actorUserId: "foreign-desktop-user",
          githubConnectionId: "connection-alice",
          githubToken: "oauth-token-must-not-be-audited",
        }),
        "app-token-alice"
      )
    );
    const body = (await response.json()) as {
      task: {
        creatingActor: string;
        credentialBinding?: unknown;
        id: string;
      };
    };

    assert.equal(response.status, 201);
    assert.equal(body.task.creatingActor, "alice-cr");
    assert.equal("credentialBinding" in body.task, false);
    assert.deepEqual(authorizeCalls, [
      {
        appToken: "app-token-alice",
        encodedKubeconfig: AUTHORIZED_ENCODED_KUBECONFIG,
        expectedNamespace: "namespace-b",
      },
    ]);
    // Every verified entry request first adopts the actor's legacy
    // generation-1 row before the uid-keyed lookup (ADR-0059).
    assert.deepEqual(adoptionCalls, [
      {
        accountUserId: undefined,
        legacyWorkspaceActor: "alice-cr",
        owner: {
          namespace: "namespace-b",
          ownerIdentityVersion: 2,
          userUid: "uid-alice",
        },
      },
    ]);
    assert.deepEqual(connectionLookups, [
      {
        namespace: "namespace-b",
        ownerIdentityVersion: 2,
        userUid: "uid-alice",
      },
    ]);
    const [stored] = await harness.db
      .select()
      .from(deployTasks)
      .where(eq(deployTasks.id, body.task.id));
    assert.equal(stored?.creatingActor, "alice-cr");
    assert.deepEqual(stored?.credentialBinding, {
      connectionRef: "connection-alice",
      credentialOwner: "uid-alice",
      version: 1,
    });
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
    // A red assertion may fire while an unexpectedly created task is still
    // mid-transition; closing PGlite with a query in flight hangs the run.
    await runDone?.catch(() => undefined);
    clearHarness();
    await harness.close();
  }
});

test("POST fails GitHub creation closed with the degradation matrix statuses", async () => {
  const harness = await createDeployTaskTestHarness();
  useHarness(harness);
  activeGithubConnection = githubConnection("connection-alice", "alice");
  try {
    const { POST } = await import("./route");

    const missingToken = await POST(deployTaskRequest(githubCreateBody()));
    assert.deepEqual(
      { body: await missingToken.json(), status: missingToken.status },
      {
        body: {
          code: "app_token_required",
          error: "Authentication is required.",
        },
        status: 401,
      }
    );

    const mismatchedToken = await POST(
      deployTaskRequest(githubCreateBody(), "app-token-bob")
    );
    assert.deepEqual(
      { body: await mismatchedToken.json(), status: mismatchedToken.status },
      {
        body: {
          code: "app_token_mismatch",
          error: "App token does not match the authenticated actor.",
        },
        status: 403,
      }
    );

    assert.equal((await harness.db.select().from(deployTasks)).length, 0);
    assert.equal(adoptionCalls.length, 0);
    assert.equal(connectionLookups.length, 0);
  } finally {
    // A red assertion may fire while an unexpectedly created task is still
    // mid-transition; closing PGlite with a query in flight hangs the run.
    await runDone?.catch(() => undefined);
    clearHarness();
    await harness.close();
  }
});

test("GET is a pure read: no events written, binding untouched (ADR 0037)", async () => {
  const harness = await createDeployTaskTestHarness();
  useHarness(harness);
  authorizedWorkspaceActor = "bob-cr";
  try {
    const task = await insertTaskRow(harness.db, {
      creatingActor: "alice-cr",
      credentialBinding: {
        connectionRef: "connection-alice",
        credentialOwner: "uid-alice",
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
    assert.equal(authorizeCalls.length, 0);
    const events = await harness.db
      .select()
      .from(deployTaskEvents)
      .where(eq(deployTaskEvents.taskId, task.id));
    assert.equal(events.length, 0);
    const [unchanged] = await harness.db
      .select()
      .from(deployTasks)
      .where(eq(deployTasks.id, task.id));
    assert.deepEqual(unchanged?.credentialBinding, task.credentialBinding);
  } finally {
    // A red assertion may fire while an unexpectedly created task is still
    // mid-transition; closing PGlite with a query in flight hangs the run.
    await runDone?.catch(() => undefined);
    clearHarness();
    await harness.close();
  }
});

test("POST ignores a removed client-selected GitHub connection", async () => {
  const harness = await createDeployTaskTestHarness();
  useHarness(harness);
  activeGithubConnection = githubConnection("connection-alice", "alice");
  try {
    const { POST } = await import("./route");
    const response = await POST(
      deployTaskRequest(
        githubCreateBody({ githubConnectionId: "connection-bob" }),
        "app-token-alice"
      )
    );

    const body = (await response.json()) as { task: { id: string } };
    assert.equal(response.status, 201);
    const [stored] = await harness.db
      .select()
      .from(deployTasks)
      .where(eq(deployTasks.id, body.task.id));
    assert.deepEqual(stored?.credentialBinding, {
      connectionRef: "connection-alice",
      credentialOwner: "uid-alice",
      version: 1,
    });
    await runDone;
  } finally {
    // A red assertion may fire while an unexpectedly created task is still
    // mid-transition; closing PGlite with a query in flight hangs the run.
    await runDone?.catch(() => undefined);
    clearHarness();
    await harness.close();
  }
});

test("POST requires the initiator's active GitHub connection before creating a task", async () => {
  const harness = await createDeployTaskTestHarness();
  useHarness(harness);
  try {
    const { POST } = await import("./route");
    const response = await POST(
      deployTaskRequest(githubCreateBody(), "app-token-alice")
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
    // A red assertion may fire while an unexpectedly created task is still
    // mid-transition; closing PGlite with a query in flight hangs the run.
    await runDone?.catch(() => undefined);
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
      deployTaskRequest(githubCreateBody(), "app-token-alice")
    );

    assert.deepEqual(
      { body: await response.json(), status: response.status },
      {
        body: {
          code: "workspace_actor_required",
          error: "A verified Workspace Actor is required.",
        },
        status: 403,
      }
    );
    assert.equal((await harness.db.select().from(deployTasks)).length, 0);
  } finally {
    // A red assertion may fire while an unexpectedly created task is still
    // mid-transition; closing PGlite with a query in flight hangs the run.
    await runDone?.catch(() => undefined);
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
      deployTaskRequest(
        {
          encodedKubeconfig: AUTHORIZED_ENCODED_KUBECONFIG,
          namespace: "namespace-b",
          predecessorTaskId: predecessor.id,
        },
        "app-token-bob"
      )
    );
    const body = (await response.json()) as {
      task: {
        creatingActor: string;
        credentialBinding?: unknown;
        id: string;
        retriedFromTaskId: string;
      };
    };
    await runDone;

    assert.equal(response.status, 201);
    assert.equal(body.task.creatingActor, "bob-cr");
    assert.equal("credentialBinding" in body.task, false);
    assert.equal(body.task.retriedFromTaskId, predecessor.id);
    assert.deepEqual(connectionLookups, [
      {
        namespace: "namespace-b",
        ownerIdentityVersion: 2,
        userUid: "uid-bob",
      },
    ]);
    const [clone] = await harness.db
      .select()
      .from(deployTasks)
      .where(eq(deployTasks.id, body.task.id));
    assert.deepEqual(clone?.source, predecessor.source);
    assert.deepEqual(clone?.target, predecessor.target);
    assert.deepEqual(clone?.artifactSummary.resultIdentities, {
      templateInstanceName: "preserved-result",
    });
    assert.deepEqual(clone?.credentialBinding, {
      connectionRef: "connection-bob",
      credentialOwner: "uid-bob",
      version: 1,
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
    // The predecessor's record is history: its actor and legacy-format
    // binding are never rewritten, and the clone never copies them.
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
    // A red assertion may fire while an unexpectedly created task is still
    // mid-transition; closing PGlite with a query in flight hangs the run.
    await runDone?.catch(() => undefined);
    clearHarness();
    await harness.close();
  }
});

test("POST redeploy fails closed without a valid app token", async () => {
  const harness = await createDeployTaskTestHarness();
  useHarness(harness);
  authorizedWorkspaceActor = "bob-cr";
  activeGithubConnection = githubConnection("connection-bob", "bob");
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
      deployTaskRequest({
        encodedKubeconfig: AUTHORIZED_ENCODED_KUBECONFIG,
        namespace: "namespace-b",
        predecessorTaskId: predecessor.id,
      })
    );

    assert.deepEqual(
      { body: await response.json(), status: response.status },
      {
        body: {
          code: "app_token_required",
          error: "Authentication is required.",
        },
        status: 401,
      }
    );
    assert.deepEqual(
      (await harness.db.select().from(deployTasks)).map((task) => task.id),
      [predecessor.id]
    );
  } finally {
    // A red assertion may fire while an unexpectedly created task is still
    // mid-transition; closing PGlite with a query in flight hangs the run.
    await runDone?.catch(() => undefined);
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
      deployTaskRequest(
        {
          encodedKubeconfig: AUTHORIZED_ENCODED_KUBECONFIG,
          namespace: "namespace-b",
          predecessorTaskId: predecessor.id,
        },
        "app-token-bob"
      )
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
    // A red assertion may fire while an unexpectedly created task is still
    // mid-transition; closing PGlite with a query in flight hangs the run.
    await runDone?.catch(() => undefined);
    clearHarness();
    await harness.close();
  }
});

test("POST creates a redeploy from a non-GitHub predecessor without consulting the token", async () => {
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
      deployTaskRequest({
        namespace: "namespace-b",
        predecessorTaskId: predecessor.id,
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

    assert.equal(authorizeCalls.length, 0);
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
    // A red assertion may fire while an unexpectedly created task is still
    // mid-transition; closing PGlite with a query in flight hangs the run.
    await runDone?.catch(() => undefined);
    clearHarness();
    await harness.close();
  }
});

test("POST drops a malformed attribution snapshot instead of rejecting the deploy", async () => {
  const harness = await createDeployTaskTestHarness();
  useHarness(harness);
  try {
    const { POST } = await import("./route");

    const response = await POST(
      deployTaskRequest({
        // Unknown version + overlong click id: fails the snapshot schema.
        marketingAttribution: {
          click_id_candidates: [],
          gclid: "x".repeat(4096),
          version: 1,
        },
        namespace: "namespace-b",
        runner: { kind: "template" },
        source: { kind: "template", templateName: "attribution-garbage" },
        target: { kind: "existingProject", projectId: "project-test" },
      })
    );
    const body = (await response.json()) as { task: { id: string } };
    assert.ok(runDone);
    await runDone;

    assert.equal(response.status, 201);
    assert.equal(authorizeCalls.length, 0);
    const [stored] = await harness.db
      .select()
      .from(deployTasks)
      .where(eq(deployTasks.id, body.task.id));
    assert.equal(stored?.marketingAttribution, null);
  } finally {
    await runDone?.catch(() => undefined);
    clearHarness();
    await harness.close();
  }
});

test("POST degrades an unverifiable consent token to scrubbed attribution instead of 401", async () => {
  const harness = await createDeployTaskTestHarness();
  useHarness(harness);
  try {
    const { POST } = await import("./route");

    // No app token on a Template create: attribution identity cannot be
    // verified, but the deploy must proceed with consent-safe scrubbing.
    const response = await POST(
      deployTaskRequest({
        encodedKubeconfig: AUTHORIZED_ENCODED_KUBECONFIG,
        marketingAttribution: {
          ad_personalization: "granted",
          ad_user_data_consent: "granted",
          click_id_candidates: [],
          consent_provenance: null,
          consent_token: "stale-or-unverifiable-token",
          first_touch: null,
          gbraid: null,
          gclid: "degrade-gclid",
          last_touch: null,
          version: 3,
          wbraid: null,
        },
        namespace: "namespace-b",
        runner: { kind: "template" },
        source: { kind: "template", templateName: "attribution-degrade" },
        target: { kind: "existingProject", projectId: "project-test" },
      })
    );
    const body = (await response.json()) as { task: { id: string } };
    assert.ok(runDone);
    await runDone;

    assert.equal(response.status, 201);
    assert.equal(authorizeCalls.length, 1);
    const [stored] = await harness.db
      .select()
      .from(deployTasks)
      .where(eq(deployTasks.id, body.task.id));
    assert.equal(
      stored?.marketingAttribution?.ad_user_data_consent,
      "unspecified"
    );
    assert.equal(stored?.marketingAttribution?.consent_provenance, null);
    assert.equal(stored?.marketingAttribution?.gclid, null);
  } finally {
    await runDone?.catch(() => undefined);
    clearHarness();
    await harness.close();
  }
});

test("client collaboratively redeploys an attributed Template with workspace-safe attribution", async () => {
  const harness = await createDeployTaskTestHarness();
  useHarness(harness);
  authorizedWorkspaceActor = "bob-cr";
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  try {
    const predecessor = await insertTaskRow(harness.db, {
      completedAt: new Date(),
      creatingActor: "alice-cr",
      namespace: "namespace-b",
      source: { kind: "template", templateName: "attributed-template" },
      status: "failed",
    });
    await harness.db
      .update(deployTasks)
      .set({
        marketingAttribution: {
          ad_personalization: "granted",
          ad_user_data_consent: "granted",
          click_id_candidates: [],
          consent_provenance: {
            issuer: "sealos-desktop",
            issued_at: "2026-08-14T00:00:00.000Z",
            jti: "template-redeploy-jti",
            region: "region-a",
            source: "desktop_oauth",
            subject_id: "uid-alice",
          },
          first_touch: null,
          gbraid: null,
          gclid: "template-redeploy-gclid",
          last_touch: null,
          version: 3,
          wbraid: null,
        },
      })
      .where(eq(deployTasks.id, predecessor.id));
    const { POST } = await import("./route");
    globalThis.window = {
      location: { origin: "https://brain.test" },
    } as unknown as Window & typeof globalThis;
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) =>
      POST(new Request(input, init))) as unknown as typeof fetch;

    const result = await redeployDeploymentTask({
      appToken: "app-token-bob",
      kubeconfig: AUTHORIZED_ENCODED_KUBECONFIG,
      namespace: "namespace-b",
      predecessorSourceKind: "template",
      predecessorTaskId: predecessor.id,
    });
    assert.ok(runDone);
    await runDone;

    assert.equal(result.conflict, false);
    assert.equal(result.task?.retriedFromTaskId, predecessor.id);
    assert.deepEqual(authorizeCalls, []);
    const [stored] = await harness.db
      .select()
      .from(deployTasks)
      .where(eq(deployTasks.retriedFromTaskId, predecessor.id));
    assert.equal(stored?.marketingAttribution?.consent_provenance, null);
    assert.equal(stored?.marketingAttribution?.gclid, null);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
    await runDone?.catch(() => undefined);
    clearHarness();
    await harness.close();
  }
});

test("POST rejects inherited attribution when the identity changes after authorization", async () => {
  const harness = await createDeployTaskTestHarness();
  useHarness(harness);
  activeGithubConnection = githubConnection("connection-alice", "alice");
  try {
    const predecessor = await insertTaskRow(harness.db, {
      completedAt: new Date(),
      creatingActor: "alice-cr",
      namespace: "namespace-b",
      source: githubCreateBody().source as never,
      status: "failed",
    });
    await harness.db
      .update(deployTasks)
      .set({
        marketingAttribution: {
          ad_personalization: "granted",
          ad_user_data_consent: "granted",
          click_id_candidates: [],
          consent_provenance: {
            issuer: "sealos-desktop",
            issued_at: "2026-08-13T00:00:00.000Z",
            jti: "route-inherited-attribution-jti",
            region: "region-a",
            source: "desktop_oauth",
            subject_id: "uid-alice",
          },
          first_touch: null,
          gbraid: null,
          gclid: null,
          last_touch: null,
          version: 3,
          wbraid: null,
        },
      })
      .where(eq(deployTasks.id, predecessor.id));
    afterAuthorize = async () => {
      await harness.db
        .update(identityFingerprints)
        .set({ mintedAt: 2, userUid: "uid-bob" })
        .where(eq(identityFingerprints.crName, "alice-cr"));
    };

    const { POST } = await import("./route");
    const response = await POST(
      deployTaskRequest(
        {
          encodedKubeconfig: AUTHORIZED_ENCODED_KUBECONFIG,
          namespace: "namespace-b",
          predecessorTaskId: predecessor.id,
        },
        "app-token-alice"
      )
    );

    assert.deepEqual(
      { body: await response.json(), status: response.status },
      {
        body: {
          code: "app_token_superseded",
          error: "Authentication is required.",
        },
        status: 401,
      }
    );
    assert.deepEqual(authorizeCalls, [
      {
        appToken: "app-token-alice",
        encodedKubeconfig: AUTHORIZED_ENCODED_KUBECONFIG,
        expectedNamespace: "namespace-b",
      },
    ]);
    assert.deepEqual(
      (await harness.db.select().from(deployTasks)).map((task) => task.id),
      [predecessor.id]
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
        deployTaskRequest(
          {
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
          },
          "app-token-alice"
        )
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
    // A red assertion may fire while an unexpectedly created task is still
    // mid-transition; closing PGlite with a query in flight hangs the run.
    await runDone?.catch(() => undefined);
    clearHarness();
    await harness.close();
  }
});

test("cancel stays namespace-shared: member B cancels A's task without a token, binding untouched", async () => {
  const harness = await createDeployTaskTestHarness();
  useHarness(harness);
  authorizedWorkspaceActor = "bob-cr";
  try {
    const task = await insertTaskRow(harness.db, {
      creatingActor: "alice-cr",
      credentialBinding: {
        connectionRef: "connection-alice",
        credentialOwner: "uid-alice",
        version: 1,
      },
      namespace: "namespace-b",
      source: githubCreateBody().source as never,
      status: "queued",
    });
    const { POST: cancelPost } = await import("./[taskId]/cancel/route");
    const response = await cancelPost(
      new Request(`https://brain.test/api/deploy-tasks/${task.id}/cancel`, {
        method: "POST",
      }),
      { params: Promise.resolve({ taskId: task.id }) }
    );
    const body = (await response.json()) as { task: { status: string } };

    assert.equal(response.status, 200);
    assert.equal(body.task.status, "cancelled");
    assert.equal(authorizeCalls.length, 0);
    const [stored] = await harness.db
      .select()
      .from(deployTasks)
      .where(eq(deployTasks.id, task.id));
    assert.deepEqual(stored?.credentialBinding, task.credentialBinding);
    const events = await harness.db
      .select()
      .from(deployTaskEvents)
      .where(eq(deployTaskEvents.taskId, task.id));
    assert.equal(
      events.find((event) => event.kind === "deployment_task.cancelled")
        ?.payload.actionActor,
      "bob-cr"
    );
  } finally {
    await runDone?.catch(() => undefined);
    clearHarness();
    await harness.close();
  }
});

test("blocking input stays namespace-shared: member B resumes A's task without a token, binding untouched", async () => {
  const harness = await createDeployTaskTestHarness();
  useHarness(harness);
  authorizedWorkspaceActor = "bob-cr";
  try {
    const task = await insertTaskRow(harness.db, {
      blockingInputs: [
        {
          id: "app-name",
          key: "APP_NAME",
          label: "Application name",
          required: true,
          sensitive: false,
          type: "text",
        },
      ],
      creatingActor: "alice-cr",
      credentialBinding: {
        connectionRef: "connection-alice",
        credentialOwner: "uid-alice",
        version: 1,
      },
      namespace: "namespace-b",
      source: githubCreateBody().source as never,
      status: "blocked",
    });
    const { POST: inputPost } = await import("./[taskId]/input/route");
    const response = await inputPost(
      new Request(`https://brain.test/api/deploy-tasks/${task.id}/input`, {
        body: JSON.stringify({ values: { APP_NAME: "my-app" } }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
      { params: Promise.resolve({ taskId: task.id }) }
    );

    assert.equal(response.status, 200);
    assert.equal(authorizeCalls.length, 0);
    await runDone;
    const [stored] = await harness.db
      .select()
      .from(deployTasks)
      .where(eq(deployTasks.id, task.id));
    assert.deepEqual(stored?.credentialBinding, task.credentialBinding);
    const events = await harness.db
      .select()
      .from(deployTaskEvents)
      .where(eq(deployTaskEvents.taskId, task.id));
    assert.equal(
      events.find((event) => event.kind === "deploy_task.input_submitted")
        ?.payload.actionActor,
      "bob-cr"
    );
  } finally {
    await runDone?.catch(() => undefined);
    clearHarness();
    await harness.close();
  }
});
