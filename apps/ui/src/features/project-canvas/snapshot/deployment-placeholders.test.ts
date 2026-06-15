import assert from "node:assert/strict";
import { test } from "node:test";

import { CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE } from "../nodes/constants";
import type {
  CanvasDeploymentPlaceholderNodeData,
  CanvasDeploymentPlaceholderRfNode,
} from "../nodes/types";
import { deploymentProjectionPlacementNodesFromPlaceholderNode } from "./deployment-placeholders";

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
  anchorSource?: CanvasDeploymentPlaceholderNodeData["projectionPositionSource"];
  position: CanvasDeploymentPlaceholderRfNode["position"];
  primary?: boolean;
  slotId: (typeof PROJECTION_SLOTS)[number]["id"];
}): CanvasDeploymentPlaceholderRfNode {
  const slot = PROJECTION_SLOTS.find((item) => item.id === input.slotId);
  return {
    data: {
      ...(slot?.expectedRef === undefined
        ? {}
        : { expectedRef: slot.expectedRef }),
      groupId: "task-1",
      hasProjectionPosition: false,
      ...(input.primary === undefined ? {} : { primary: input.primary }),
      ...(input.anchorSource === undefined
        ? {}
        : { projectionPositionSource: input.anchorSource }),
      projectionShape: "result-preview",
      projectionSlots: [...PROJECTION_SLOTS],
      slotId: input.slotId,
      taskId: "task-1",
    },
    id: `deployment-result-placeholder-task-1-${input.slotId}`,
    position: input.position,
    type: CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE,
  };
}

test("projection patch preserves user source for a preview primary anchored by a moved generic placeholder", () => {
  const nodes = [
    resultPreviewNode({
      anchorSource: "user",
      position: { x: 680, y: 280 },
      primary: true,
      slotId: AP_SLOT.id,
    }),
    resultPreviewNode({
      anchorSource: "user",
      position: { x: 340, y: 280 },
      slotId: PUBLIC_ACCESS_SLOT.id,
    }),
  ];
  const primaryNode = nodes[0];
  assert.ok(primaryNode);

  const placementNodes = deploymentProjectionPlacementNodesFromPlaceholderNode({
    node: primaryNode,
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

test("projection patch moves every preview slot when a result placeholder is dragged", () => {
  const nodes = [
    resultPreviewNode({
      position: { x: 680, y: 280 },
      primary: true,
      slotId: AP_SLOT.id,
    }),
    resultPreviewNode({
      position: { x: 340, y: 280 },
      slotId: PUBLIC_ACCESS_SLOT.id,
    }),
  ];
  const primaryNode = nodes[0];
  assert.ok(primaryNode);
  const movedAp = {
    ...primaryNode,
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
      {
        owner: {
          kind: "deploymentProjection",
          slotId: PUBLIC_ACCESS_SLOT.id,
          taskId: "task-1",
        },
        position: { x: 440, y: 320 },
        source: "user",
      },
    ]
  );
});
