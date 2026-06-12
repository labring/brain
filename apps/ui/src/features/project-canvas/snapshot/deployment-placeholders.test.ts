import assert from "node:assert/strict";
import { test } from "node:test";

import { CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE } from "../nodes/constants";
import type {
  CanvasDeploymentPlaceholderNodeData,
  CanvasDeploymentPlaceholderRfNode,
} from "../nodes/types";
import { deploymentProjectionPatchFromPlaceholderNode } from "./deployment-placeholders";

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

  const patch = deploymentProjectionPatchFromPlaceholderNode({
    node: nodes[0],
    nodes,
    source: "generated",
  });

  assert.equal(patch?.kind, "result-preview");
  assert.deepEqual(
    patch?.projection.slots?.map((slot) => ({
      id: slot.id,
      position: slot.position,
    })),
    [
      {
        id: AP_SLOT.id,
        position: { source: "user", x: 680, y: 280 },
      },
      {
        id: PUBLIC_ACCESS_SLOT.id,
        position: { source: "generated", x: 340, y: 280 },
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
  const movedAp = {
    ...nodes[0],
    position: { x: 780, y: 320 },
  };

  const patch = deploymentProjectionPatchFromPlaceholderNode({
    node: movedAp,
    nodes,
    source: "user",
  });

  assert.equal(patch?.kind, "result-preview");
  assert.deepEqual(
    patch?.projection.slots?.map((slot) => ({
      id: slot.id,
      position: slot.position,
    })),
    [
      {
        id: AP_SLOT.id,
        position: { source: "user", x: 780, y: 320 },
      },
      {
        id: PUBLIC_ACCESS_SLOT.id,
        position: { source: "user", x: 440, y: 320 },
      },
    ]
  );
});
