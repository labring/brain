import assert from "node:assert/strict";
import { test } from "node:test";
import { DEPLOYMENT_UNKNOWN_SLOT_ID } from "../layout/placement-owner";
import { CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE } from "../nodes/constants";
import type { CanvasDeploymentPlaceholderRfNode } from "../nodes/types";
import { deploymentProjectionPlacementNodeFromUserDrag } from "./deployment-user-placement";

function placeholder(input: {
  position: CanvasDeploymentPlaceholderRfNode["position"];
  slotId: string;
}): CanvasDeploymentPlaceholderRfNode {
  return {
    data: {
      groupId: "task-1",
      hasProjectionPlacement: false,
      slotId: input.slotId,
      taskId: "task-1",
    },
    id: `deployment-result-placeholder-task-1-${input.slotId}`,
    position: input.position,
    type: CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE,
  };
}

test("User Canvas Placement moves only the dragged preview slot", () => {
  const movedAp = placeholder({
    position: { x: 780, y: 320 },
    slotId: "AP:default:api",
  });

  assert.deepEqual(deploymentProjectionPlacementNodeFromUserDrag(movedAp), {
    owner: {
      kind: "deploymentProjection",
      slotId: "AP:default:api",
      taskId: "task-1",
    },
    position: { x: 780, y: 320 },
    source: "user",
  });
});

test("User Canvas Placement persists an unknown slot independently", () => {
  const unknown = placeholder({
    position: { x: 240, y: 160 },
    slotId: DEPLOYMENT_UNKNOWN_SLOT_ID,
  });

  assert.deepEqual(deploymentProjectionPlacementNodeFromUserDrag(unknown), {
    owner: {
      kind: "deploymentProjection",
      slotId: DEPLOYMENT_UNKNOWN_SLOT_ID,
      taskId: "task-1",
    },
    position: { x: 240, y: 160 },
    source: "user",
  });
});

test("User Canvas Placement preserves the AP sibling when PublicAccess is dragged", () => {
  const ap = placeholder({
    position: { x: 680, y: 280 },
    slotId: "AP:default:api",
  });
  const movedPublicAccess = placeholder({
    position: { x: 120, y: 640 },
    slotId: "PublicAccess:default:api",
  });

  assert.deepEqual(
    deploymentProjectionPlacementNodeFromUserDrag(movedPublicAccess),
    {
      owner: {
        kind: "deploymentProjection",
        slotId: "PublicAccess:default:api",
        taskId: "task-1",
      },
      position: { x: 120, y: 640 },
      source: "user",
    }
  );
  assert.deepEqual(ap.position, { x: 680, y: 280 });
});
