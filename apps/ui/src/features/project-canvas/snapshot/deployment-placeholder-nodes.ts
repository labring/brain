import type { Node } from "@xyflow/react";
import type { DeploymentTaskProjection } from "@/features/deploy/task/projection";
import { COLUMN_STEP } from "../layout/placement-geometry";
import { DEPLOYMENT_UNKNOWN_SLOT_ID } from "../layout/placement-owner";
import type { CanvasLayoutDocument } from "../layout/types";
import { CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE } from "../nodes/constants";
import type {
  CanvasDeploymentPlaceholderNodeData,
  CanvasDeploymentPlaceholderRfNode,
} from "../nodes/types";
import {
  createDeploymentProjectionContext,
  type DeploymentProjectionContext,
  deploymentProjectionPlacementFromContext,
  resultRefHasLiveNodeInDeploymentProjectionContext,
  resultRefHasSavedLayoutInDeploymentProjectionContext,
} from "./deployment-projection-context";
import {
  anchorSlot,
  type DeploymentResultPreview,
  type DeploymentTaskResultPreview,
  materializedSlotPositions,
  resultRefForSlot,
  sanitizeNodeIdPart,
  shouldShowDeploymentPlaceholder,
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
  context: DeploymentProjectionContext
): CanvasDeploymentPlaceholderRfNode {
  const placement = deploymentProjectionPlacementFromContext(context, {
    slotId: DEPLOYMENT_UNKNOWN_SLOT_ID,
    taskId: task.id,
  });
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
  context: DeploymentProjectionContext;
  task: DeploymentTaskProjection;
  preview: DeploymentResultPreview;
}): CanvasDeploymentPlaceholderRfNode[] {
  const { positions, relative, saved } = materializedSlotPositions({
    layout: input.context.layout,
    slots: input.preview.slots,
    task: input.task,
  });
  const anchor = anchorSlot(input.preview.slots);
  const unknownSlotPlacement = deploymentProjectionPlacementFromContext(
    input.context,
    {
      slotId: DEPLOYMENT_UNKNOWN_SLOT_ID,
      taskId: input.task.id,
    }
  );
  return input.preview.slots.flatMap((slot) => {
    const placement = deploymentProjectionPlacementFromContext(input.context, {
      slotId: slot.id,
      taskId: input.task.id,
    });
    const expectedResultRef = resultRefForSlot({ slot, task: input.task });
    if (
      expectedResultRef !== undefined &&
      (resultRefHasSavedLayoutInDeploymentProjectionContext(
        input.context,
        expectedResultRef
      ) ||
        resultRefHasLiveNodeInDeploymentProjectionContext(
          input.context,
          expectedResultRef
        ))
    ) {
      return [];
    }
    const position = positions.get(slot.id) ?? { x: 0, y: 0 };
    const projectionPlacementSource =
      placement?.source ?? unknownSlotPlacement?.source;
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
        const itemPlacement = deploymentProjectionPlacementFromContext(
          input.context,
          {
            slotId: item.id,
            taskId: input.task.id,
          }
        );
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
    previews?: readonly DeploymentTaskResultPreview[];
    context?: DeploymentProjectionContext;
  }
): CanvasDeploymentPlaceholderRfNode[] {
  if (tasks == null) {
    return [];
  }
  const context =
    options?.context ??
    createDeploymentProjectionContext({
      layout: options?.layout,
      nodes: options?.nodes,
      previews: options?.previews,
      tasks,
    });
  return tasks.flatMap((task, index) => {
    if (!shouldShowDeploymentPlaceholder(task, options?.now)) {
      return [];
    }
    const preview = context.previewByTaskId.get(task.id);
    if (preview !== undefined) {
      return resultPreviewPlaceholderNodes({
        context,
        preview,
        task,
      });
    }
    return [unknownSlotPlaceholderNode(task, index, context)];
  });
}

function resultRefForPlaceholderHandoff(input: {
  context: DeploymentProjectionContext;
  node: CanvasDeploymentPlaceholderRfNode;
}) {
  const slotId = input.node.data.slotId;
  if (slotId === undefined) {
    return undefined;
  }

  const preview = input.context.previews.find(
    ({ task }) => task.id === input.node.data.taskId
  );
  const slot = preview?.preview.slots.find((item) => item.id === slotId);
  return preview === undefined || slot === undefined
    ? undefined
    : resultRefForSlot({ slot, task: preview.task });
}

export function shouldHideDeploymentPlaceholderForHandoff(input: {
  context: DeploymentProjectionContext;
  node: CanvasDeploymentPlaceholderRfNode;
}): boolean {
  if (hasProjectionSlotGroup(input.node.data)) {
    const resultRef = resultRefForPlaceholderHandoff(input);
    return (
      resultRef !== undefined &&
      (resultRefHasSavedLayoutInDeploymentProjectionContext(
        input.context,
        resultRef
      ) ||
        (input.node.data.hasProjectionPlacement === true &&
          resultRefHasLiveNodeInDeploymentProjectionContext(
            input.context,
            resultRef
          )))
    );
  }

  return false;
}
