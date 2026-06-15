import assert from "node:assert/strict";
import { test } from "node:test";
import type { Node } from "@xyflow/react";

import { CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE } from "../nodes/constants";
import type {
  CanvasDeploymentPlaceholderNodeData,
  CanvasDeploymentPlaceholderRfNode,
} from "../nodes/types";
import {
  deploymentPreviewEdgesFromTasks,
  deploymentProjectionPlacementNodesFromPlaceholderNode,
} from "./deployment-placeholders";

const AP_SLOT = {
  expectedRef: {
    kind: "AP",
    name: "api",
    namespace: "default",
  },
  id: "AP:default:api",
} as const;

const PUBLIC_ACCESS_SLOT = {
  expectedRef: {
    kind: "PublicAccess",
    name: "api",
    namespace: "default",
  },
  id: "PublicAccess:default:api",
} as const;

const PROJECTION_SLOTS = [AP_SLOT, PUBLIC_ACCESS_SLOT] as const;

function resultPreviewNode(input: {
  anchorSource?: CanvasDeploymentPlaceholderNodeData["projectionPlacementSource"];
  anchor?: boolean;
  position: CanvasDeploymentPlaceholderRfNode["position"];
  slotId: (typeof PROJECTION_SLOTS)[number]["id"];
}): CanvasDeploymentPlaceholderRfNode {
  const slot = PROJECTION_SLOTS.find((item) => item.id === input.slotId);
  return {
    data: {
      ...(slot?.expectedRef === undefined
        ? {}
        : { expectedRef: slot.expectedRef }),
      groupId: "task-1",
      hasProjectionPlacement: false,
      ...(input.anchor === undefined ? {} : { anchor: input.anchor }),
      ...(input.anchorSource === undefined
        ? {}
        : { projectionPlacementSource: input.anchorSource }),
      projectionSlots: PROJECTION_SLOTS.map((projectionSlot) => ({
        ...projectionSlot,
        ...(projectionSlot.id === AP_SLOT.id ? { anchor: true } : {}),
      })),
      slotId: input.slotId,
      taskId: "task-1",
    },
    id: `deployment-result-placeholder-task-1-${input.slotId}`,
    position: input.position,
    type: CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE,
  };
}

test("projection patch preserves user source for a slot group anchored by the unknown slot", () => {
  const nodes = [
    resultPreviewNode({
      anchor: true,
      anchorSource: "user",
      position: { x: 680, y: 280 },
      slotId: AP_SLOT.id,
    }),
    resultPreviewNode({
      anchorSource: "user",
      position: { x: 340, y: 280 },
      slotId: PUBLIC_ACCESS_SLOT.id,
    }),
  ];
  const anchorNode = nodes[0];
  assert.ok(anchorNode);

  const placementNodes = deploymentProjectionPlacementNodesFromPlaceholderNode({
    node: anchorNode,
    nodes,
    source: "generated",
  });

  assert.deepEqual(
    placementNodes.map((node) => ({
      owner: node.owner,
      position: node.position,
      source: node.source,
    })),
    [
      {
        owner: {
          kind: "deploymentProjection",
          slotId: AP_SLOT.id,
          taskId: "task-1",
        },
        position: { x: 680, y: 280 },
        source: "user",
      },
      {
        owner: {
          kind: "deploymentProjection",
          slotId: PUBLIC_ACCESS_SLOT.id,
          taskId: "task-1",
        },
        position: { x: 340, y: 280 },
        source: "generated",
      },
    ]
  );
});

test("projection patch moves only the dragged preview slot", () => {
  const nodes = [
    resultPreviewNode({
      anchor: true,
      position: { x: 680, y: 280 },
      slotId: AP_SLOT.id,
    }),
    resultPreviewNode({
      position: { x: 340, y: 280 },
      slotId: PUBLIC_ACCESS_SLOT.id,
    }),
  ];
  const anchorNode = nodes[0];
  assert.ok(anchorNode);
  const movedAp = {
    ...anchorNode,
    position: { x: 780, y: 320 },
  };

  const placementNodes = deploymentProjectionPlacementNodesFromPlaceholderNode({
    node: movedAp,
    nodes,
    source: "user",
  });

  assert.deepEqual(
    placementNodes.map((node) => ({
      owner: node.owner,
      position: node.position,
      source: node.source,
    })),
    [
      {
        owner: {
          kind: "deploymentProjection",
          slotId: AP_SLOT.id,
          taskId: "task-1",
        },
        position: { x: 780, y: 320 },
        source: "user",
      },
    ]
  );
});

test("projection patch preserves sibling preview slots when PublicAccess is dragged", () => {
  const nodes = [
    resultPreviewNode({
      anchor: true,
      position: { x: 680, y: 280 },
      slotId: AP_SLOT.id,
    }),
    resultPreviewNode({
      position: { x: 340, y: 280 },
      slotId: PUBLIC_ACCESS_SLOT.id,
    }),
  ];
  const publicAccessNode = nodes[1];
  assert.ok(publicAccessNode);
  const movedPublicAccess = {
    ...publicAccessNode,
    position: { x: 120, y: 640 },
  };

  const placementNodes = deploymentProjectionPlacementNodesFromPlaceholderNode({
    node: movedPublicAccess,
    nodes,
    source: "user",
  });

  assert.deepEqual(
    placementNodes.map((node) => ({
      owner: node.owner,
      position: node.position,
      source: node.source,
    })),
    [
      {
        owner: {
          kind: "deploymentProjection",
          slotId: PUBLIC_ACCESS_SLOT.id,
          taskId: "task-1",
        },
        position: { x: 120, y: 640 },
        source: "user",
      },
    ]
  );
});

test("preview edges stay scoped to placeholders from their own deployment task", () => {
  const slotIds = ["AP:default:api", "DB:default:postgres"] as const;
  const nodes: Node[] = ["task-1", "task-2"].flatMap((taskId, taskIndex) =>
    slotIds.map((slotId, slotIndex) => ({
      data: {
        expectedRef:
          slotIndex === 0
            ? { kind: "AP", name: "api", namespace: "default" }
            : { kind: "DB", name: "postgres", namespace: "default" },
        projectionSlots: slotIds.map((id) => ({ id })),
        slotId,
        taskId,
      },
      id: `${taskId}-${slotId}`,
      position: { x: taskIndex * 340, y: slotIndex * 280 },
      type: CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE,
    }))
  );

  const edges = deploymentPreviewEdgesFromTasks({
    nodes,
    tasks: ["task-1", "task-2"].map((taskId) => ({
      artifactSummary: {},
      canvasProjection: {
        edges: [
          {
            id: "ap-db",
            sourceSlotId: "AP:default:api",
            targetSlotId: "DB:default:postgres",
          },
        ],
        slots: [
          {
            expectedRef: { kind: "AP", name: "api", namespace: "default" },
            id: "AP:default:api",
          },
          {
            expectedRef: {
              kind: "DB",
              name: "postgres",
              namespace: "default",
            },
            id: "DB:default:postgres",
          },
        ],
      },
      completedAt: null,
      id: taskId,
      namespace: "default",
      phase: "apply",
      projectId: "project-uid",
      status: "applying",
      updatedAt: "2026-06-11T10:00:00.000Z",
    })),
  });

  assert.deepEqual(
    edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
    })),
    [
      {
        id: "deployment-preview-task-1-ap-db",
        source: "task-1-AP:default:api",
        target: "task-1-DB:default:postgres",
      },
      {
        id: "deployment-preview-task-2-ap-db",
        source: "task-2-AP:default:api",
        target: "task-2-DB:default:postgres",
      },
    ]
  );
});
