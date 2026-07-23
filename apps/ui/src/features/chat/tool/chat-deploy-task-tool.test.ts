// @ts-expect-error bun exposes mock at runtime; direct tsc in this repo lacks bun:test types.
import { mock } from "bun:test";
import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_DOCKER_APP_LISTENING_PORT } from "@/features/deploy/docker-deployment-settings";
import type { StartDeployTaskRunnerInput } from "@/features/deploy/task/runner";
import type {
  DeploymentTaskTimelineSnapshotDTO,
  DeployTaskSnapshotDTO,
} from "@/features/deploy/task/types";

import { createDeployTaskToolInputSchema } from "./chat-deploy-task-input";

const timelineSnapshotReads: { namespace?: string; taskId: string }[] = [];
let timelineSnapshot: DeploymentTaskTimelineSnapshotDTO | null = null;

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

test("chat getDeployTaskStatus returns the safe task timeline snapshot", async () => {
  timelineSnapshotReads.length = 0;
  timelineSnapshot = failedTimelineSnapshot();

  const { createDeployTaskTools } = await import("./chat-deploy-task-tool");
  const deployTaskTools = createDeployTaskTools(
    {
      kubeconfig: "test-kubeconfig",
      kubernetesNamespace: "ns-test",
      workspaceActor: "alice",
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
          ["API_KEY"],
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
    currentBlockingInputKeys: ["API_KEY"],
    encodedKubeconfig: "test-kubeconfig",
    submittedInputValues: { API_KEY: "secret-value" },
    taskId: "task-1",
  });
  assert.deepEqual(result, { ok: true, task: taskSnapshot.task });
});
