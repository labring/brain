import { mock } from "bun:test";
import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_DOCKER_APP_LISTENING_PORT } from "@/features/deploy/docker-deployment-settings";
import type { StartDeployTaskRunnerInput } from "@/features/deploy/task/runner";
import type {
  DeploymentTaskTimelineSnapshotDTO,
  DeployTaskSnapshotDTO,
} from "@/features/deploy/task/types";
import { IdentityBindingSupersededError } from "@/lib/identity-fingerprint-core";

import { createDeployTaskToolInputSchema } from "./chat-deploy-task-input";

const timelineSnapshotReads: { namespace?: string; taskId: string }[] = [];
let timelineSnapshot: DeploymentTaskTimelineSnapshotDTO | null = null;
const CONNECTION_DATABASE_UNAVAILABLE_RE = /connection database unavailable/;

// `server-only` has no runtime API and throws outside a React server runtime,
// so this process-wide shim cannot change another test's observable behavior.
mock.module("server-only", () => ({}));

function failedTimelineSnapshot(): DeploymentTaskTimelineSnapshotDTO {
  return {
    events: [
      {
        createdAt: "2026-07-23T00:00:00.000Z",
        kind: "deployment_task.failed",
        message: "Repository analysis timed out. Redeploy to try again.",
        payload: { reason: "gateway-timeout" },
        phase: "generate-artifacts",
        seq: 4,
        taskId: "task-1",
      },
    ],
    task: {
      artifactSummary: {},
      blockingInputs: [],
      canvasProjection: {},
      completedAt: "2026-07-23T00:00:00.000Z",
      createdAt: "2026-07-22T23:59:00.000Z",
      createdFrom: "chat",
      error: "Repository analysis timed out. Redeploy to try again.",
      failureDetails: { reason: "gateway-timeout" },
      gatewaySessionId: null,
      gatewayStateSnapshot: null,
      gatewayTurnId: null,
      gatewayUrl: null,
      id: "task-1",
      namespace: "ns-test",
      phase: "generate-artifacts",
      previewUrl: null,
      projectId: "project-1",
      projectName: "Project 1",
      resultUrl: null,
      runner: { kind: "ai", runtimeProvider: "devbox" },
      runtimeName: null,
      runtimeProvider: null,
      runtimeState: null,
      source: { kind: "prompt", text: "Deploy the repository." },
      startedAt: "2026-07-22T23:59:01.000Z",
      status: "failed",
      target: { kind: "existingProject", projectId: "project-1" },
      timelineSnapshot: null,
      updatedAt: "2026-07-23T00:00:00.000Z",
    },
    timeline: {
      revision: 3,
      status: "failed",
      steps: [],
      taskId: "task-1",
      updatedAt: "2026-07-23T00:00:00.000Z",
    },
  };
}

function blockedTaskSnapshot(): DeployTaskSnapshotDTO {
  const task = failedTimelineSnapshot().task;
  return {
    events: [],
    messages: [],
    task: {
      ...task,
      blockingInputs: [
        {
          id: "API_KEY",
          key: "API_KEY",
          label: "API key",
          required: true,
          sensitive: true,
          type: "secret",
        },
      ],
      completedAt: null,
      error: null,
      failureDetails: null,
      phase: "configure",
      status: "blocked",
    },
  };
}

test("chat createDeployTask defaults minimal Docker image settings", () => {
  const parsed = createDeployTaskToolInputSchema.safeParse({
    intention: "deploy official nginx image into current project",
    source: {
      kind: "docker",
      settings: {
        image: "nginx:latest",
      },
    },
  });

  assert.equal(parsed.success, true);
  if (!parsed.success) {
    return;
  }
  assert.equal(parsed.data.source.kind, "docker");
  assert.deepEqual(parsed.data.source.settings, {
    appListeningPort: DEFAULT_DOCKER_APP_LISTENING_PORT,
    env: [],
    image: "nginx:latest",
  });
});

test("chat createDeployTask ignores model-provided raw runner fields", () => {
  const parsed = createDeployTaskToolInputSchema.safeParse({
    intention: "deploy official nginx image into current project",
    runner: { kind: "deterministic" },
    source: {
      kind: "docker",
      settings: {
        image: "nginx:latest",
      },
    },
  });

  assert.equal(parsed.success, true);
  if (!parsed.success) {
    return;
  }
  assert.equal("runner" in parsed.data, false);
  assert.equal(parsed.data.source.kind, "docker");
  assert.equal(
    parsed.data.source.settings.appListeningPort,
    DEFAULT_DOCKER_APP_LISTENING_PORT
  );
});

test("chat createDeployTask rejects inconsistent GitHub repository identity", () => {
  const parsed = createDeployTaskToolInputSchema.safeParse({
    intention: "deploy the requested GitHub repository",
    source: {
      kind: "github",
      repo: {
        fullName: "public/example",
        name: "example",
        url: "https://github.com/private/other",
      },
    },
  });

  assert.equal(parsed.success, false);
});

test("chat getDeployTaskStatus returns the safe task timeline snapshot", async () => {
  timelineSnapshotReads.length = 0;
  timelineSnapshot = failedTimelineSnapshot();

  const { createDeployTaskTools } = await import("./chat-deploy-task-tool");
  const deployTaskTools = createDeployTaskTools(
    {
      kubeconfig: "test-kubeconfig",
      kubernetesNamespace: "ns-test",
      workspaceActor: "alice",
      workspaceUserUid: "uid-alice",
    },
    {
      getDeployTaskTimelineSnapshot: (
        taskId: string,
        namespace?: string
      ): Promise<DeploymentTaskTimelineSnapshotDTO | null> => {
        timelineSnapshotReads.push({ namespace, taskId });
        return Promise.resolve(timelineSnapshot);
      },
    }
  );
  assert.ok(deployTaskTools.getDeployTaskStatus.execute);

  const result = await deployTaskTools.getDeployTaskStatus.execute(
    {
      intention: "inspect safe deployment progress",
      taskId: "task-1",
    },
    { messages: [], toolCallId: "tool-call-1" }
  );

  assert.deepEqual(timelineSnapshotReads, [
    { namespace: "ns-test", taskId: "task-1" },
  ]);
  assert.deepEqual(result, { ok: true, snapshot: timelineSnapshot });
  assert.ok("snapshot" in result);
  assert.equal("messages" in result.snapshot, false);
});

test("chat submitDeployTaskInput preserves the active blocker keys", async () => {
  let runInput: StartDeployTaskRunnerInput | null = null;
  const taskSnapshot = blockedTaskSnapshot();
  const { createDeployTaskTools } = await import("./chat-deploy-task-tool");
  const deployTaskTools = createDeployTaskTools(
    {
      kubeconfig: "test-kubeconfig",
      kubernetesNamespace: "ns-test",
      workspaceActor: "alice",
      workspaceUserUid: "uid-alice",
    },
    {
      getDeployTaskEngineContext: () => null as never,
      getDeployTaskSnapshot: () => Promise.resolve(taskSnapshot),
      runDeployTask: (_handle, input) => {
        runInput = input;
        return Promise.resolve();
      },
      submitDeployTaskInputAction: async (_context, input) => {
        await input.run(
          null as never,
          { id: input.taskId } as never,
          [
            {
              id: "API_KEY",
              key: "API_KEY",
              label: "API key",
              required: true,
              sensitive: true,
              type: "secret",
            },
          ],
          { API_KEY: "secret-value" }
        );
        return {
          kind: "resumed",
          launched: null as never,
          task: { id: input.taskId } as never,
        };
      },
      toDeployTaskDTO: () => taskSnapshot.task,
    }
  );
  assert.ok(deployTaskTools.submitDeployTaskInput.execute);

  const result = await deployTaskTools.submitDeployTaskInput.execute(
    {
      intention: "supply the requested API key",
      taskId: "task-1",
      values: { API_KEY: "secret-value" },
    },
    { messages: [], toolCallId: "tool-call-2" }
  );

  assert.deepEqual(runInput, {
    currentBlockingInputs: [
      {
        id: "API_KEY",
        key: "API_KEY",
        label: "API key",
        required: true,
        sensitive: true,
        type: "secret",
      },
    ],
    encodedKubeconfig: "test-kubeconfig",
    submittedInputValues: { API_KEY: "secret-value" },
    taskId: "task-1",
  });
  assert.deepEqual(result, { ok: true, task: taskSnapshot.task });
});

const githubSource = {
  kind: "github" as const,
  repo: {
    fullName: "glpi-project/glpi",
    name: "glpi",
    url: "https://github.com/glpi-project/glpi",
  },
};

function githubToolOptions() {
  return {
    kubeconfig: "test-kubeconfig",
    kubernetesNamespace: "ns-test",
    workspaceActor: "alice",
    workspaceUserUid: "uid-alice",
  };
}

function githubConnection() {
  return {
    accountLogin: "alice",
    accountType: "User",
    id: "connection-alice",
    installationId: "",
    isAuthorized: true,
    namespace: "ns-test",
    repositorySelection: "oauth",
    updatedAt: new Date(0).toISOString(),
  };
}

test("chat createDeployTask requires a GitHub connection before task creation", async () => {
  let createCalls = 0;
  const { createDeployTaskTools } = await import("./chat-deploy-task-tool");
  const deployTaskTools = createDeployTaskTools(githubToolOptions(), {
    adoptLegacyGithubConnectionForOwner: () =>
      Promise.resolve(undefined as never),
    createDeployTaskAction: () => {
      createCalls += 1;
      return Promise.resolve({ kind: "invalid", message: "unexpected" });
    },
    getGithubConnectionStatusForOwner: () => Promise.resolve(null),
  });
  assert.ok(deployTaskTools.createDeployTask.execute);

  const result = await deployTaskTools.createDeployTask.execute(
    {
      intention: "deploy the glpi repository",
      source: githubSource,
      target: { kind: "newProject", displayName: "glpi" },
    },
    { messages: [], toolCallId: "tool-call-3" }
  );

  assert.deepEqual(result, {
    ok: false,
    error: "Connect GitHub in Settings before deploying from a repository.",
  });
  assert.equal(createCalls, 0);
});

test("chat createDeployTask binds the initiator's GitHub connection", async () => {
  const createInputs: { credentialBinding?: unknown }[] = [];
  const { createDeployTaskTools } = await import("./chat-deploy-task-tool");
  const deployTaskTools = createDeployTaskTools(githubToolOptions(), {
    adoptLegacyGithubConnectionForOwner: () =>
      Promise.resolve(undefined as never),
    createDeployTaskAction: (_context, input) => {
      createInputs.push(input.create);
      return Promise.resolve({
        kind: "created",
        launched: null,
        task: { id: "task-9" } as never,
      });
    },
    getDeployTaskEngineContext: () => null as never,
    getDeployTaskSnapshot: () => Promise.resolve(null),
    getGithubConnectionStatusForOwner: () =>
      Promise.resolve(githubConnection()),
    runDeployTask: () => Promise.resolve(),
    toDeployTaskDTO: (task: unknown) => task as never,
  });
  assert.ok(deployTaskTools.createDeployTask.execute);

  const result = await deployTaskTools.createDeployTask.execute(
    {
      intention: "deploy the glpi repository",
      source: githubSource,
      target: { kind: "newProject", displayName: "glpi" },
    },
    { messages: [], toolCallId: "tool-call-4" }
  );

  assert.ok(result != null && "ok" in result && result.ok);
  assert.equal(createInputs.length, 1);
  assert.deepEqual(createInputs[0]?.credentialBinding, {
    connectionRef: "connection-alice",
    credentialOwner: "uid-alice",
    version: 1,
  });
});

test("chat createDeployTask surfaces a superseded identity without creating a task", async () => {
  let createCalls = 0;
  const { createDeployTaskTools } = await import("./chat-deploy-task-tool");
  const deployTaskTools = createDeployTaskTools(githubToolOptions(), {
    adoptLegacyGithubConnectionForOwner: () =>
      Promise.reject(new IdentityBindingSupersededError()),
    createDeployTaskAction: () => {
      createCalls += 1;
      return Promise.resolve({ kind: "invalid", message: "unexpected" });
    },
  });
  assert.ok(deployTaskTools.createDeployTask.execute);

  const result = await deployTaskTools.createDeployTask.execute(
    {
      intention: "deploy the glpi repository",
      source: githubSource,
      target: { kind: "newProject", displayName: "glpi" },
    },
    { messages: [], toolCallId: "tool-call-5" }
  );

  assert.deepEqual(result, {
    ok: false,
    error:
      "Authentication is required. Sign in again before deploying from GitHub.",
  });
  assert.equal(createCalls, 0);
});

test("chat createDeployTask propagates GitHub connection lookup failures", async () => {
  const { createDeployTaskTools } = await import("./chat-deploy-task-tool");
  const deployTaskTools = createDeployTaskTools(githubToolOptions(), {
    adoptLegacyGithubConnectionForOwner: () =>
      Promise.resolve(undefined as never),
    getGithubConnectionStatusForOwner: () =>
      Promise.reject(new Error("connection database unavailable")),
  });
  assert.ok(deployTaskTools.createDeployTask.execute);

  await assert.rejects(async () => {
    await deployTaskTools.createDeployTask.execute?.(
      {
        intention: "deploy the glpi repository",
        source: githubSource,
        target: { kind: "newProject", displayName: "glpi" },
      },
      { messages: [], toolCallId: "tool-call-6" }
    );
  }, CONNECTION_DATABASE_UNAVAILABLE_RE);
});

test("chat createDeployTask refuses behind the pre-deploy wall and never creates the task", async () => {
  let createCalls = 0;
  const standingReads: string[] = [];
  const { createDeployTaskTools } = await import("./chat-deploy-task-tool");
  const deployTaskTools = createDeployTaskTools(
    {
      ...githubToolOptions(),
      billingActor: { userId: "user-alice", userUid: "uid-alice" },
    },
    {
      adoptLegacyGithubConnectionForOwner: () =>
        Promise.resolve(undefined as never),
      createDeployTaskAction: () => {
        createCalls += 1;
        return Promise.resolve({ kind: "invalid", message: "unexpected" });
      },
      getGithubConnectionStatusForOwner: () =>
        Promise.resolve(githubConnection()),
      judgeWorkspaceBillingStandingForActor: (input) => {
        standingReads.push(input.workspace);
        return Promise.resolve({
          accountDebt: true,
          aiCredits: null,
          availableBalanceMicroUnits: -6_320_000,
          fullQuota: null,
          fullUniversalQuota: null,
          paidSource: "balance",
          paymentDue: false,
          paymentDueRecovery: null,
          quotaKnown: true,
          subscriptionPaused: false,
        });
      },
    }
  );
  assert.ok(deployTaskTools.createDeployTask.execute);

  const result = await deployTaskTools.createDeployTask.execute(
    {
      intention: "deploy the glpi repository",
      source: githubSource,
      target: { kind: "newProject", displayName: "glpi" },
    },
    { messages: [], toolCallId: "tool-call-wall" }
  );

  assert.deepEqual(standingReads, ["ns-test"]);
  assert.deepEqual(result, {
    ok: false,
    error:
      "Account balance in debt. Pay-as-you-go workspaces are suspended, so deployments will fail. Top up your balance to restore them. The deployment was not started. If the user wants to try anyway, the deployment pane shows this same notice but does not block.",
  });
  assert.equal(createCalls, 0);
});
