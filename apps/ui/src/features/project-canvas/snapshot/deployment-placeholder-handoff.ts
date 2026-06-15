import type { Node } from "@xyflow/react";
import type { DeploymentTaskProjection } from "@/lib/deploy-task/projection";
import type {
  CanvasLayoutDocument,
  CanvasLayoutPosition,
} from "../layout/types";
import {
  canvasResourceIdentityFromNode,
  canvasResourceKey,
} from "../nodes/resource-identity";
import {
  type DeploymentResultPreview,
  type DeploymentTaskResultResourceRef,
  deploymentResultPreview,
  layoutHasRef,
  materializedSlotPositions,
  nodesByRef,
  nodesByTemplateKey,
  resultRefForSlot,
  resultRefHasLiveNode,
  slotProjectionPlacement,
  templateNodeKeyFromNode,
  unknownSlotProjectionPlacement,
} from "./deployment-projection-model";

export function deploymentPlaceholderHandoffs(input: {
  layout?: CanvasLayoutDocument;
  nodes: readonly Node[];
  tasks?: readonly DeploymentTaskProjection[];
}): {
  byNodeId: Map<string, CanvasLayoutPosition>;
  byRef: Map<string, CanvasLayoutPosition>;
} {
  const byNodeId = new Map<string, CanvasLayoutPosition>();
  const byRef = new Map<string, CanvasLayoutPosition>();
  for (const task of input.tasks ?? []) {
    const preview = deploymentResultPreview(task);
    if (preview !== undefined) {
      addPreviewHandoffs({
        byNodeId,
        byRef,
        layout: input.layout,
        nodes: input.nodes,
        preview,
        task,
      });
    }
  }
  return { byNodeId, byRef };
}

function addResultRefHandoff(input: {
  byNodeId: Map<string, CanvasLayoutPosition>;
  byRef: Map<string, CanvasLayoutPosition>;
  layout?: CanvasLayoutDocument;
  nodes: readonly Node[];
  position: CanvasLayoutPosition;
  ref: DeploymentTaskResultResourceRef;
}): void {
  if (input.ref.kind === "TemplateNative") {
    const node = nodesByTemplateKey(input.nodes).get(
      `${input.ref.namespace}/${input.ref.name}`
    );
    if (node !== undefined) {
      input.byNodeId.set(node.id, input.position);
    }
    return;
  }
  if (layoutHasRef(input.layout, input.ref)) {
    return;
  }
  if (nodesByRef(input.nodes).has(canvasResourceKey(input.ref))) {
    input.byRef.set(canvasResourceKey(input.ref), input.position);
  }
}

function addPreviewHandoffs(input: {
  byNodeId: Map<string, CanvasLayoutPosition>;
  byRef: Map<string, CanvasLayoutPosition>;
  layout?: CanvasLayoutDocument;
  nodes: readonly Node[];
  preview: DeploymentResultPreview;
  task: DeploymentTaskProjection;
}): void {
  const materialized = materializedSlotPositions({
    layout: input.layout,
    slots: input.preview.slots,
    task: input.task,
  });
  const unknownSlotPlacement = unknownSlotProjectionPlacement({
    layout: input.layout,
    task: input.task,
  });
  for (const slot of input.preview.slots) {
    const slotPlacement = slotProjectionPlacement({
      layout: input.layout,
      slot,
      task: input.task,
    });
    const position =
      slotPlacement?.position ??
      (unknownSlotPlacement === undefined
        ? undefined
        : materialized.positions.get(slot.id));
    const expectedRef = resultRefForSlot({ slot, task: input.task });
    if (position === undefined || expectedRef === undefined) {
      continue;
    }
    addResultRefHandoff({
      byNodeId: input.byNodeId,
      byRef: input.byRef,
      layout: input.layout,
      nodes: input.nodes,
      position,
      ref: expectedRef,
    });
  }
}

export function deploymentPlaceholderPendingResultKeys(input: {
  layout?: CanvasLayoutDocument;
  nodes?: readonly Node[];
  tasks?: readonly DeploymentTaskProjection[];
}): {
  refs: Set<string>;
  templates: Set<string>;
} {
  const refs = new Set<string>();
  const templates = new Set<string>();
  for (const task of input.tasks ?? []) {
    const preview = deploymentResultPreview(task);
    if (preview === undefined) {
      continue;
    }
    addPreviewPendingResultKeys({
      layout: input.layout,
      nodes: input.nodes,
      preview,
      refs,
      task,
      templates,
    });
  }
  return { refs, templates };
}

function addPendingResultKey(input: {
  layout?: CanvasLayoutDocument;
  nodes?: readonly Node[];
  ref: DeploymentTaskResultResourceRef;
  refs: Set<string>;
  templates: Set<string>;
}): void {
  if (resultRefHasLiveNode(input.ref, input.nodes ?? [])) {
    return;
  }
  if (input.ref.kind === "TemplateNative") {
    input.templates.add(`${input.ref.namespace}/${input.ref.name}`);
    return;
  }
  if (!layoutHasRef(input.layout, input.ref)) {
    input.refs.add(canvasResourceKey(input.ref));
  }
}

function addPreviewPendingResultKeys(input: {
  layout?: CanvasLayoutDocument;
  nodes?: readonly Node[];
  preview: DeploymentResultPreview;
  refs: Set<string>;
  task: DeploymentTaskProjection;
  templates: Set<string>;
}): void {
  for (const slot of input.preview.slots) {
    const expectedRef = resultRefForSlot({ slot, task: input.task });
    if (
      expectedRef === undefined ||
      slotProjectionPlacement({
        layout: input.layout,
        slot,
        task: input.task,
      }) !== undefined
    ) {
      continue;
    }
    addPendingResultKey({
      layout: input.layout,
      nodes: input.nodes,
      ref: expectedRef,
      refs: input.refs,
      templates: input.templates,
    });
  }
}

export function isDeploymentPlaceholderPendingResultNode(input: {
  keys: ReturnType<typeof deploymentPlaceholderPendingResultKeys>;
  node: Node;
}): boolean {
  const ref = canvasResourceIdentityFromNode(input.node);
  if (ref !== undefined && input.keys.refs.has(canvasResourceKey(ref))) {
    return true;
  }
  const templateKey = templateNodeKeyFromNode(input.node);
  return templateKey !== undefined && input.keys.templates.has(templateKey);
}
