import type { Node } from "@xyflow/react";
import type { DeploymentTaskProjection } from "@/lib/deploy-task/projection";
import { COLUMN_STEP } from "../layout/placement-geometry";
import { DEPLOYMENT_UNKNOWN_SLOT_ID } from "../layout/placement-owner";
import type { CanvasLayoutDocument } from "../layout/types";
import { CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE } from "../nodes/constants";
import type {
  CanvasDeploymentPlaceholderNodeData,
  CanvasDeploymentPlaceholderRfNode,
} from "../nodes/types";
import {
  anchorSlot,
  type DeploymentResultPreview,
  deploymentResultPreview,
  expectedRefToResultRef,
  materializedSlotPositions,
  resultRefForSlot,
  resultRefHasLiveNode,
  resultRefHasSavedLayout,
  sanitizeNodeIdPart,
  shouldShowDeploymentPlaceholder,
  slotProjectionPlacement,
  unknownSlotProjectionPlacement,
} from "./deployment-projection-model";

function projectionSlotNodeId(taskId: string, slotId: string): string {
  return `deployment-result-placeholder-${sanitizeNodeIdPart(taskId)}-${sanitizeNodeIdPart(slotId)}`;
}

export function deploymentPlaceholderNodeId(taskId: string): string {
  return `deployment-placeholder-${sanitizeNodeIdPart(taskId)}`;
}

export function isDeploymentPlaceholderNode(
  node: Node | undefined
): node is CanvasDeploymentPlaceholderRfNode {
  return node?.type === CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE;
}

export function hasProjectionSlotGroup(
  data: CanvasDeploymentPlaceholderNodeData
): data is CanvasDeploymentPlaceholderNodeData & {
  projectionSlots: NonNullable<
    CanvasDeploymentPlaceholderNodeData["projectionSlots"]
  >;
} {
  return Array.isArray(data.projectionSlots) && data.projectionSlots.length > 0;
}

export function deploymentPlaceholderTaskIdFromNode(
  node: Node | undefined
): string | undefined {
  return isDeploymentPlaceholderNode(node) ? node.data.taskId : undefined;
}

function unknownSlotPlaceholderNode(
  task: DeploymentTaskProjection,
  index: number,
  layout?: CanvasLayoutDocument
): CanvasDeploymentPlaceholderRfNode {
  const placement = unknownSlotProjectionPlacement({ layout, task });
  return {
    data: {
      groupId: task.id,
      hasProjectionPlacement: placement !== undefined,
      ...(placement?.source === undefined
        ? {}
        : { projectionPlacementSource: placement.source }),
      slotId: DEPLOYMENT_UNKNOWN_SLOT_ID,
      taskId: task.id,
    },
    id: deploymentPlaceholderNodeId(task.id),
    position: placement?.position ?? {
      x: index * COLUMN_STEP,
      y: 0,
    },
    type: CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE,
  };
}

function resultPreviewPlaceholderNodes(input: {
  layout?: CanvasLayoutDocument;
  nodes?: readonly Node[];
  task: DeploymentTaskProjection;
  preview: DeploymentResultPreview;
}): CanvasDeploymentPlaceholderRfNode[] {
  const { positions, relative, saved } = materializedSlotPositions({
    layout: input.layout,
    slots: input.preview.slots,
    task: input.task,
  });
  const anchor = anchorSlot(input.preview.slots);
  const unknownSlotPlacement = unknownSlotProjectionPlacement({
    layout: input.layout,
    task: input.task,
  });
  return input.preview.slots.flatMap((slot) => {
    const placement = slotProjectionPlacement({
      layout: input.layout,
      slot,
      task: input.task,
    });
    const expectedResultRef = resultRefForSlot({ slot, task: input.task });
    if (
      expectedResultRef !== undefined &&
      (resultRefHasSavedLayout(expectedResultRef, input.layout) ||
        resultRefHasLiveNode(expectedResultRef, input.nodes ?? []))
    ) {
      return [];
    }
    const position = positions.get(slot.id) ?? { x: 0, y: 0 };
    const projectionPlacementSource =
      placement?.source ??
      (slot.id === anchor?.id ? unknownSlotPlacement?.source : undefined);
    const data: CanvasDeploymentPlaceholderNodeData = {
      ...(slot.expectedRef === undefined
        ? {}
        : { expectedRef: slot.expectedRef }),
      anchor: slot.anchor === true || anchor?.id === slot.id,
      groupId: input.task.id,
      hasProjectionPlacement: saved.has(slot.id),
      projectionEdges: input.preview.edges,
      ...(projectionPlacementSource === undefined
        ? {}
        : { projectionPlacementSource }),
      projectionRelativePlacement: relative.get(slot.id) ?? { x: 0, y: 0 },
      projectionSlots: input.preview.slots.map((item) => {
        const itemPlacement = slotProjectionPlacement({
          layout: input.layout,
          slot: item,
          task: input.task,
        });
        return {
          ...(item.expectedRef === undefined
            ? {}
            : { expectedRef: item.expectedRef }),
          id: item.id,
          ...(itemPlacement === undefined
            ? {}
            : {
                position: {
                  ...(itemPlacement.source === undefined
                    ? {}
                    : { source: itemPlacement.source }),
                  x: itemPlacement.position.x,
                  y: itemPlacement.position.y,
                },
              }),
          ...(item.anchor === undefined ? {} : { anchor: item.anchor }),
        };
      }),
      slotId: slot.id,
      taskId: input.task.id,
    };
    return [
      {
        data,
        id: projectionSlotNodeId(input.task.id, slot.id),
        position,
        type: CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE,
      },
    ];
  });
}

export function deploymentPlaceholderNodesFromTasks(
  tasks: readonly DeploymentTaskProjection[] | undefined,
  options?: {
    layout?: CanvasLayoutDocument;
    nodes?: readonly Node[];
    now?: Date;
  }
): CanvasDeploymentPlaceholderRfNode[] {
  if (tasks == null) {
    return [];
  }
  return tasks.flatMap((task, index) => {
    if (!shouldShowDeploymentPlaceholder(task, options?.now)) {
      return [];
    }
    const preview = deploymentResultPreview(task);
    if (preview !== undefined) {
      return resultPreviewPlaceholderNodes({
        layout: options?.layout,
        nodes: options?.nodes,
        preview,
        task,
      });
    }
    return [unknownSlotPlaceholderNode(task, index, options?.layout)];
  });
}

export function shouldHideDeploymentPlaceholderForHandoff(input: {
  layout?: CanvasLayoutDocument;
  node: CanvasDeploymentPlaceholderRfNode;
  nodes: readonly Node[];
}): boolean {
  if (hasProjectionSlotGroup(input.node.data)) {
    const expectedRef = expectedRefToResultRef(input.node.data.expectedRef);
    return (
      expectedRef !== undefined &&
      (resultRefHasSavedLayout(expectedRef, input.layout) ||
        (input.node.data.hasProjectionPlacement === true &&
          resultRefHasLiveNode(expectedRef, input.nodes)))
    );
  }

  return false;
}
