import type { Node } from "@xyflow/react";
import type { DeploymentTaskProjection } from "@/features/deploy/task/projection";
import type { DeploymentTaskCanvasProjectionSlot } from "@/features/deploy/task/types";
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
  CanvasPlacementOwner,
  CanvasPlacementSource,
  PlacementCommand,
} from "../layout/types";
import type { CanvasDeploymentPlaceholderNodeData } from "../nodes/types";
import {
  hasProjectionSlotGroup,
  isDeploymentPlaceholderNode,
} from "./deployment-placeholder-nodes";
import {
  createDeploymentProjectionContext,
  type DeploymentProjectionContext,
  nodeForResultRefInDeploymentProjectionContext,
  resultRefHasLiveNodeInDeploymentProjectionContext,
  resultRefHasSavedLayoutInDeploymentProjectionContext,
} from "./deployment-projection-context";
import {
  type DeploymentResultPreview,
  type DeploymentTaskResultPreview,
  deploymentSlotOwnerKey,
  layoutRefForSlot,
  materializedSlotPositions,
  resultRefForSlot,
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

function projectionSlotPlacementOwner(slot: {
  id: string;
  taskId: string;
}): ReturnType<typeof deploymentProjectionPlacementOwner> {
  return deploymentProjectionPlacementOwner({
    slotId: slot.id,
    taskId: slot.taskId,
  });
}

class PlacementCommandDraft {
  private readonly commands: PlacementCommand[] = [];
  private readonly nodesByOwner: Map<string, CanvasLayoutNode>;
  private readonly seen = new Set<string>();

  constructor(context: DeploymentProjectionContext) {
    this.nodesByOwner = new Map(context.layoutByOwner);
  }

  hasOwner(owner: CanvasPlacementOwner): boolean {
    return this.nodesByOwner.has(canvasPlacementOwnerKey(owner));
  }

  node(owner: CanvasPlacementOwner): CanvasLayoutNode | undefined {
    return this.nodesByOwner.get(canvasPlacementOwnerKey(owner));
  }

  create(input: {
    owner: CanvasPlacementOwner;
    position: CanvasLayoutPosition;
    source: CanvasPlacementSource;
  }): void {
    const key = canvasPlacementOwnerKey(input.owner);
    if (this.nodesByOwner.has(key)) {
      return;
    }
    if (
      !this.addCommand({
        kind: "create",
        owner: input.owner,
        position: input.position,
        source: input.source,
      })
    ) {
      return;
    }
    this.nodesByOwner.set(
      key,
      canvasLayoutNodeFromOwner({
        owner: input.owner,
        position: input.position,
        source: input.source,
      })
    );
  }

  delete(owner: CanvasPlacementOwner): void {
    const key = canvasPlacementOwnerKey(owner);
    if (!this.nodesByOwner.has(key)) {
      return;
    }
    if (!this.addCommand({ kind: "delete", owner })) {
      return;
    }
    this.nodesByOwner.delete(key);
  }

  rekey(fromOwner: CanvasPlacementOwner, toOwner: CanvasPlacementOwner): void {
    const fromKey = canvasPlacementOwnerKey(fromOwner);
    const toKey = canvasPlacementOwnerKey(toOwner);
    const fromNode = this.nodesByOwner.get(fromKey);
    if (fromNode === undefined) {
      return;
    }
    if (this.nodesByOwner.has(toKey)) {
      this.delete(fromOwner);
      return;
    }
    if (!this.addCommand({ fromOwner, kind: "rekey", toOwner })) {
      return;
    }
    this.nodesByOwner.delete(fromKey);
    this.nodesByOwner.set(toKey, {
      ...canvasLayoutNodeFromOwner({
        owner: toOwner,
        position: fromNode.position,
        source: fromNode.source,
      }),
      ...(fromNode.expanded === undefined
        ? {}
        : { expanded: fromNode.expanded }),
      ...(fromNode.lastSeenUid === undefined
        ? {}
        : { lastSeenUid: fromNode.lastSeenUid }),
      ...(fromNode.stackOrder === undefined
        ? {}
        : { stackOrder: fromNode.stackOrder }),
    });
  }

  toCommands(): PlacementCommand[] {
    return this.commands;
  }

  private addCommand(command: PlacementCommand): boolean {
    const key =
      command.kind === "rekey"
        ? `${command.kind}:${canvasPlacementOwnerKey(command.fromOwner)}:${canvasPlacementOwnerKey(command.toOwner)}`
        : `${command.kind}:${canvasPlacementOwnerKey(command.owner)}`;
    if (this.seen.has(key)) {
      return false;
    }
    this.seen.add(key);
    this.commands.push(command);
    return true;
  }
}

function projectionSlotIsVisible(
  task: DeploymentTaskProjection,
  now: Date
): boolean {
  return shouldShowDeploymentPlaceholder(task, now);
}

function resourceOwnerForSlotResult(input: {
  context: DeploymentProjectionContext;
  slot: DeploymentTaskCanvasProjectionSlot;
  task: DeploymentTaskProjection;
}): ReturnType<typeof resourcePlacementOwner> | undefined {
  const layoutRef = layoutRefForSlot({
    slot: input.slot,
    task: input.task,
  });
  const resultRef = resultRefForSlot({
    slot: input.slot,
    task: input.task,
  });
  if (layoutRef === undefined || resultRef === undefined) {
    return undefined;
  }
  if (
    !(
      resultRefHasLiveNodeInDeploymentProjectionContext(
        input.context,
        resultRef
      ) ||
      resultRefHasSavedLayoutInDeploymentProjectionContext(
        input.context,
        resultRef
      )
    )
  ) {
    return undefined;
  }
  return resourcePlacementOwner(layoutRef);
}

function visiblePlacementOwnerForSlot(input: {
  context: DeploymentProjectionContext;
  slot: DeploymentTaskCanvasProjectionSlot;
  task: DeploymentTaskProjection;
}): CanvasPlacementOwner {
  return (
    resourceOwnerForSlotResult(input) ??
    projectionSlotPlacementOwner({
      id: input.slot.id,
      taskId: input.task.id,
    })
  );
}

function addUnknownSlotRefinementCommands(input: {
  context: DeploymentProjectionContext;
  draft: PlacementCommandDraft;
  preview: DeploymentResultPreview;
  task: DeploymentTaskProjection;
}): void {
  const fromOwner = deploymentProjectionPlacementOwner({
    slotId: DEPLOYMENT_UNKNOWN_SLOT_ID,
    taskId: input.task.id,
  });
  const unknownNode = input.draft.node(fromOwner);
  if (unknownNode === undefined) {
    return;
  }
  const source = unknownNode.source ?? "generated";
  const materialized = materializedSlotPositions({
    layout: input.context.layout,
    slots: input.preview.slots,
    task: input.task,
  });
  for (const slot of input.preview.slots) {
    const owner = visiblePlacementOwnerForSlot({
      context: input.context,
      slot,
      task: input.task,
    });
    if (input.draft.hasOwner(owner)) {
      continue;
    }
    const resultRef = resultRefForSlot({ slot, task: input.task });
    const position =
      (resultRef === undefined
        ? undefined
        : nodeForResultRefInDeploymentProjectionContext(
            input.context,
            resultRef
          )?.position) ??
      input.context.placeholderByTaskSlotId.get(
        deploymentSlotOwnerKey(input.task.id, slot.id)
      )?.position ??
      materialized.positions.get(slot.id);
    if (position === undefined) {
      continue;
    }
    input.draft.create({
      owner,
      position,
      source,
    });
  }
  input.draft.delete(fromOwner);
}

function addSlotHandoffOrExpiryCommand(input: {
  context: DeploymentProjectionContext;
  draft: PlacementCommandDraft;
  slot: DeploymentTaskCanvasProjectionSlot;
  task: DeploymentTaskProjection;
  now: Date;
}): void {
  const slotOwner = projectionSlotPlacementOwner({
    id: input.slot.id,
    taskId: input.task.id,
  });
  if (!input.draft.hasOwner(slotOwner)) {
    return;
  }

  const resourceOwner = resourceOwnerForSlotResult({
    context: input.context,
    slot: input.slot,
    task: input.task,
  });
  if (resourceOwner !== undefined) {
    input.draft.rekey(slotOwner, resourceOwner);
    return;
  }

  if (!projectionSlotIsVisible(input.task, input.now)) {
    input.draft.delete(slotOwner);
  }
}

function addUnknownSlotExpiryCommand(input: {
  draft: PlacementCommandDraft;
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
  input.draft.delete(owner);
}

export function deploymentProjectionPlacementCommands(input: {
  context?: DeploymentProjectionContext;
  layout?: CanvasLayoutDocument;
  nodes?: readonly Node[];
  now?: Date;
  previews?: readonly DeploymentTaskResultPreview[];
  tasks?: readonly DeploymentTaskProjection[];
}): PlacementCommand[] {
  const now = input.now ?? new Date();
  const context =
    input.context ??
    createDeploymentProjectionContext({
      layout: input.layout,
      nodes: input.nodes,
      previews: input.previews,
      tasks: input.tasks,
    });
  const draft = new PlacementCommandDraft(context);

  for (const task of context.tasks) {
    const preview = context.previewByTaskId.get(task.id);
    if (preview === undefined) {
      addUnknownSlotExpiryCommand({
        draft,
        now,
        task,
      });
      continue;
    }

    addUnknownSlotRefinementCommands({
      context,
      draft,
      preview,
      task,
    });
    for (const slot of preview.slots) {
      addSlotHandoffOrExpiryCommand({
        context,
        draft,
        now,
        slot,
        task,
      });
    }
  }

  return draft.toCommands();
}
