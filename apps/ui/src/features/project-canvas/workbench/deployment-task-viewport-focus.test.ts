import assert from "node:assert/strict";
import { test } from "node:test";
import type { Node } from "@xyflow/react";
import type { DeploymentTaskProjection } from "@/lib/deploy-task/projection";
import {
  CANVAS_CONTAINER_NODE_TYPE,
  CANVAS_DATABASE_NODE_TYPE,
  CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE,
} from "../nodes/constants";
import { deploymentTaskViewportFocusNodeIds } from "../snapshot/deployment-viewport-focus";

function task(
  overrides: Partial<DeploymentTaskProjection>
): DeploymentTaskProjection {
  return {
    artifactSummary: {},
    canvasProjection: {},
    completedAt: null,
    id: "task-1",
    namespace: "default",
    phase: "apply",
    projectId: "project-1",
    status: "running",
    updatedAt: "2026-06-17T10:00:00.000Z",
    ...overrides,
  };
}

const placeholderNode = {
  data: {
    taskId: "task-1",
  },
  id: "deployment-placeholder-task-1",
  position: { x: 0, y: 0 },
  type: CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE,
} satisfies Node;

const apNode = {
  data: {
    states: {
      kind: "AP",
      name: "api",
      namespace: "default",
    },
  },
  id: "ap-api",
  position: { x: 320, y: 0 },
  type: CANVAS_CONTAINER_NODE_TYPE,
} satisfies Node;

const dbNode = {
  data: {
    connections: [],
    states: { name: "postgres" },
    workload: {
      name: "postgres",
      namespace: "default",
    },
  },
  id: "db-postgres",
  position: { x: 640, y: 0 },
  type: CANVAS_DATABASE_NODE_TYPE,
} satisfies Node;

test("deployment task viewport focus prefers visible placeholders", () => {
  const result = deploymentTaskViewportFocusNodeIds({
    nodes: [apNode, placeholderNode],
    taskId: "task-1",
    tasks: [
      task({
        canvasProjection: {
          slots: [
            {
              expectedRef: { kind: "AP", name: "api", namespace: "default" },
              id: "ap",
            },
          ],
        },
      }),
    ],
  });

  assert.deepEqual(result, ["deployment-placeholder-task-1"]);
});

test("deployment task viewport focus falls back to handed-off result nodes", () => {
  const result = deploymentTaskViewportFocusNodeIds({
    nodes: [apNode, dbNode],
    taskId: "task-1",
    tasks: [
      task({
        canvasProjection: {
          slots: [
            {
              expectedRef: { kind: "AP", name: "api", namespace: "default" },
              id: "ap",
            },
            {
              expectedRef: {
                kind: "DB",
                name: "postgres",
                namespace: "default",
              },
              id: "db",
            },
          ],
        },
      }),
    ],
  });

  assert.deepEqual(result, ["ap-api", "db-postgres"]);
});

test("deployment task viewport focus follows explicit result mappings", () => {
  const result = deploymentTaskViewportFocusNodeIds({
    nodes: [apNode],
    taskId: "task-1",
    tasks: [
      task({
        canvasProjection: {
          resultMappings: [
            {
              actualRef: { kind: "AP", name: "api", namespace: "default" },
              slotId: "generated-ap",
            },
          ],
          slots: [{ id: "generated-ap" }],
        },
      }),
    ],
  });

  assert.deepEqual(result, ["ap-api"]);
});

test("deployment task viewport focus stays empty without visible targets", () => {
  const result = deploymentTaskViewportFocusNodeIds({
    nodes: [apNode],
    taskId: "task-2",
    tasks: [task({ id: "task-1" })],
  });

  assert.deepEqual(result, []);
});
