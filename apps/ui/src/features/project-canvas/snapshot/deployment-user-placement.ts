import type { Node } from "@xyflow/react";
import {
  canvasLayoutNodeFromOwner,
  DEPLOYMENT_UNKNOWN_SLOT_ID,
  deploymentProjectionPlacementOwner,
} from "../layout/placement-owner";
import type { CanvasLayoutNode } from "../layout/types";
import { isDeploymentPlaceholderNode } from "./deployment-placeholder-nodes";

export function deploymentProjectionPlacementNodeFromUserDrag(
  node: Node
): CanvasLayoutNode | undefined {
  if (!isDeploymentPlaceholderNode(node)) {
    return undefined;
  }
  return canvasLayoutNodeFromOwner({
    owner: deploymentProjectionPlacementOwner({
      slotId: node.data.slotId ?? DEPLOYMENT_UNKNOWN_SLOT_ID,
      taskId: node.data.taskId,
    }),
    position: node.position,
    source: "user",
  });
}
