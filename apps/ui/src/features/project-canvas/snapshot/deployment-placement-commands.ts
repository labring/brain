import type { Node } from "@xyflow/react";
import type { DeploymentTaskProjection } from "@/lib/deploy-task/projection";
import type { DeploymentTaskCanvasProjectionSlot } from "@/lib/deploy-task/types";
import {
  canvasLayoutNodeFromOwner,
  canvasPlacementOwnerKey,
  DEPLOYMENT_UNKNOWN_SLOT_ID,
  deploymentProjectionPlacementOwner,
  resourcePlacementOwner,
} from "../layout/placement-owner";
import type {
  CanvasLayoutDocument,
  CanvasLayoutNode,
  CanvasLayoutPosition,
  CanvasPlacementSource,
  PlacementCommand,
} from "../layout/types";
import type { CanvasDeploymentPlaceholderNodeData } from "../nodes/types";
import {
  hasProjectionSlotGroup,
  isDeploymentPlaceholderNode,
} from "./deployment-placeholder-nodes";
import {
  anchorSlot,
  type DeploymentResultPreview,
  deploymentResultPreview,
  layoutNodeByOwner,
  layoutRefForSlot,
  materializedSlotPositions,
  resourceOwnerKey,
  resultRefForSlot,
  resultRefHasLiveNode,
  shouldShowDeploymentPlaceholder,
} from "./deployment-projection-model";

function projectionPlacementNode(input: {
  position: CanvasLayoutPosition;
  slotId: string;
  source: CanvasPlacementSource;
  taskId: string;
}): CanvasLayoutNode {
  return canvasLayoutNodeFromOwner({
    owner: deploymentProjectionPlacementOwner({
      slotId: input.slotId,
      taskId: input.taskId,
    }),
    position: input.position,
    source: input.source,
  });
}

function projectionSlotPlacementSource(input: {
  anchorSource: CanvasDeploymentPlaceholderNodeData["projectionPlacementSource"];
  anchorSlotId: string | undefined;
  saveSource: CanvasPlacementSource;
  slot: NonNullable<
    CanvasDeploymentPlaceholderNodeData["projectionSlots"]
  >[number];
}): CanvasPlacementSource {
  if (input.saveSource === "user") {
    return "user";
  }
  return input.anchorSource === "user" && input.slot.id === input.anchorSlotId
    ? "user"
    : "generated";
}

export function deploymentProjectionPlacementNodesFromPlaceholderNode(input: {
  node: Node;
  nodes: readonly Node[];
  source: CanvasPlacementSource;
}): CanvasLayoutNode[] {
  if (!isDeploymentPlaceholderNode(input.node)) {
    return [];
  }
  const placeholderNode = input.node;
  if (!hasProjectionSlotGroup(placeholderNode.data)) {
    return [
      projectionPlacementNode({
        position: placeholderNode.position,
        slotId: placeholderNode.data.slotId ?? DEPLOYMENT_UNKNOWN_SLOT_ID,
        source: input.source,
        taskId: placeholderNode.data.taskId,
      }),
    ];
  }

  if (input.source === "user") {
    const slotId = placeholderNode.data.slotId;
    return slotId === undefined
      ? []
      : [
          projectionPlacementNode({
            position: placeholderNode.position,
            slotId,
            source: input.source,
            taskId: placeholderNode.data.taskId,
          }),
        ];
  }

  const groupNodes = input.nodes.filter(
    (node) =>
      isDeploymentPlaceholderNode(node) &&
      node.data.taskId === placeholderNode.data.taskId &&
      hasProjectionSlotGroup(node.data)
  );
  const anchorSlotId =
    placeholderNode.data.projectionSlots.find((slot) => slot.anchor === true)
      ?.id ??
    (placeholderNode.data.anchor === true
      ? placeholderNode.data.slotId
      : undefined);
  return placeholderNode.data.projectionSlots.map((slot) => {
    const node =
      groupNodes.find((candidate) => candidate.data.slotId === slot.id) ??
      (placeholderNode.data.slotId === slot.id ? placeholderNode : undefined);
    const position = node?.position ?? slot.position ?? { x: 0, y: 0 };
    return projectionPlacementNode({
      position,
      slotId: slot.id,
      source: projectionSlotPlacementSource({
        anchorSource: placeholderNode.data.projectionPlacementSource,
        anchorSlotId,
        saveSource: input.source,
        slot,
      }),
      taskId: placeholderNode.data.taskId,
    });
  });
}

function hasLayoutOwner(
  layout: CanvasLayoutDocument | undefined,
  ownerKey: string
): boolean {
  return layoutNodeByOwner(layout).has(ownerKey);
}

function projectionSlotPlacementOwner(slot: {
  id: string;
  taskId: string;
}): ReturnType<typeof deploymentProjectionPlacementOwner> {
  return deploymentProjectionPlacementOwner({
    slotId: slot.id,
    taskId: slot.taskId,
  });
}

function addCommandOnce(
  commands: PlacementCommand[],
  seen: Set<string>,
  command: PlacementCommand
): void {
  const key =
    command.kind === "rekey"
      ? `${command.kind}:${canvasPlacementOwnerKey(command.fromOwner)}:${canvasPlacementOwnerKey(command.toOwner)}`
      : `${command.kind}:${canvasPlacementOwnerKey(command.owner)}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  commands.push(command);
}

function projectionSlotIsVisible(
  task: DeploymentTaskProjection,
  now: Date
): boolean {
  return shouldShowDeploymentPlaceholder(task, now);
}

function addUnknownSlotRefinementCommands(input: {
  commands: PlacementCommand[];
  layout?: CanvasLayoutDocument;
  preview: DeploymentResultPreview;
  seen: Set<string>;
  task: DeploymentTaskProjection;
}): void {
  const anchor = anchorSlot(input.preview.slots);
  if (anchor === undefined) {
    return;
  }
  const fromOwner = deploymentProjectionPlacementOwner({
    slotId: DEPLOYMENT_UNKNOWN_SLOT_ID,
    taskId: input.task.id,
  });
  const fromKey = canvasPlacementOwnerKey(fromOwner);
  if (!hasLayoutOwner(input.layout, fromKey)) {
    return;
  }
  const toOwner = projectionSlotPlacementOwner({
    id: anchor.id,
    taskId: input.task.id,
  });
  addCommandOnce(input.commands, input.seen, {
    fromOwner,
    kind: "rekey",
    toOwner,
  });
  const materialized = materializedSlotPositions({
    layout: input.layout,
    slots: input.preview.slots,
    task: input.task,
  });
  for (const slot of input.preview.slots) {
    if (slot.id === anchor.id) {
      continue;
    }
    const owner = projectionSlotPlacementOwner({
      id: slot.id,
      taskId: input.task.id,
    });
    if (hasLayoutOwner(input.layout, canvasPlacementOwnerKey(owner))) {
      continue;
    }
    const position = materialized.positions.get(slot.id);
    if (position === undefined) {
      continue;
    }
    addCommandOnce(input.commands, input.seen, {
      kind: "create",
      owner,
      position,
      source: "generated",
    });
  }
}

function addSlotHandoffOrExpiryCommand(input: {
  commands: PlacementCommand[];
  layout?: CanvasLayoutDocument;
  nodes: readonly Node[];
  seen: Set<string>;
  slot: DeploymentTaskCanvasProjectionSlot;
  task: DeploymentTaskProjection;
  now: Date;
}): void {
  const slotOwner = projectionSlotPlacementOwner({
    id: input.slot.id,
    taskId: input.task.id,
  });
  const slotOwnerKey = canvasPlacementOwnerKey(slotOwner);
  if (!hasLayoutOwner(input.layout, slotOwnerKey)) {
    return;
  }

  const expectedRef = layoutRefForSlot({
    slot: input.slot,
    task: input.task,
  });
  const expectedResultRef = resultRefForSlot({
    slot: input.slot,
    task: input.task,
  });
  if (
    expectedRef !== undefined &&
    expectedResultRef !== undefined &&
    resultRefHasLiveNode(expectedResultRef, input.nodes)
  ) {
    const resourceOwner = resourcePlacementOwner(expectedRef);
    if (hasLayoutOwner(input.layout, resourceOwnerKey(expectedRef))) {
      addCommandOnce(input.commands, input.seen, {
        kind: "delete",
        owner: slotOwner,
      });
      return;
    }
    addCommandOnce(input.commands, input.seen, {
      fromOwner: slotOwner,
      kind: "rekey",
      toOwner: resourceOwner,
    });
    return;
  }

  if (!projectionSlotIsVisible(input.task, input.now)) {
    addCommandOnce(input.commands, input.seen, {
      kind: "delete",
      owner: slotOwner,
    });
  }
}

function addUnknownSlotExpiryCommand(input: {
  commands: PlacementCommand[];
  layout?: CanvasLayoutDocument;
  seen: Set<string>;
  task: DeploymentTaskProjection;
  now: Date;
}): void {
  if (projectionSlotIsVisible(input.task, input.now)) {
    return;
  }
  const owner = deploymentProjectionPlacementOwner({
    slotId: DEPLOYMENT_UNKNOWN_SLOT_ID,
    taskId: input.task.id,
  });
  if (!hasLayoutOwner(input.layout, canvasPlacementOwnerKey(owner))) {
    return;
  }
  addCommandOnce(input.commands, input.seen, {
    kind: "delete",
    owner,
  });
}

export function deploymentProjectionPlacementCommands(input: {
  layout?: CanvasLayoutDocument;
  nodes: readonly Node[];
  now?: Date;
  tasks?: readonly DeploymentTaskProjection[];
}): PlacementCommand[] {
  const commands: PlacementCommand[] = [];
  const seen = new Set<string>();
  const now = input.now ?? new Date();

  for (const task of input.tasks ?? []) {
    const preview = deploymentResultPreview(task);
    if (preview === undefined) {
      addUnknownSlotExpiryCommand({
        commands,
        layout: input.layout,
        now,
        seen,
        task,
      });
      continue;
    }

    addUnknownSlotRefinementCommands({
      commands,
      layout: input.layout,
      preview,
      seen,
      task,
    });
    for (const slot of preview.slots) {
      addSlotHandoffOrExpiryCommand({
        commands,
        layout: input.layout,
        nodes: input.nodes,
        now,
        seen,
        slot,
        task,
      });
    }
  }

  return commands;
}
