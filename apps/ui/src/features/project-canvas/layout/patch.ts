import { cleanupCanvasLayoutDocument } from "./cleanup";
import {
  canvasLayoutNodeFromOwner,
  canvasLayoutNodeKey,
  canvasPlacementOwnerFromLayoutNode,
  canvasPlacementOwnerKey,
  canvasPlacementOwnersEqual,
  resourcePlacementOwner,
} from "./placement-owner";
import {
  canvasStackOrderValue,
  normalizeCanvasLayoutStackOrders,
} from "./stack-order";
import type {
  CanvasLayoutDocument,
  CanvasLayoutNode,
  CanvasLayoutPatch,
  CanvasLayoutResourceRef,
  CanvasPlacementOwner,
  PlacementCommand,
} from "./types";

export interface ApplyCanvasLayoutPatchOptions {
  now?: Date;
}

export class CanvasLayoutValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanvasLayoutValidationError";
  }
}

function assertNonEmpty(value: string, field: string): string {
  const trimmed = value.trim();
  if (trimmed === "") {
    throw new CanvasLayoutValidationError(`${field} is required.`);
  }
  return trimmed;
}

function optionalTrimmed(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}

function normalizeOptionalTimestamp(
  value: string | undefined,
  field: string
): string | undefined {
  const trimmed = optionalTrimmed(value);
  if (trimmed === undefined) {
    return undefined;
  }
  if (!Number.isFinite(Date.parse(trimmed))) {
    throw new CanvasLayoutValidationError(`${field} must be a valid date.`);
  }
  return trimmed;
}

function normalizeOptionalStackOrder(
  value: number | undefined
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const stackOrder = canvasStackOrderValue(value);
  if (stackOrder === undefined) {
    throw new CanvasLayoutValidationError(
      "stackOrder must be a finite integer."
    );
  }
  return stackOrder;
}

function normalizeRef(ref: CanvasLayoutResourceRef): CanvasLayoutResourceRef {
  return {
    kind: ref.kind,
    name: assertNonEmpty(ref.name, "resource name"),
    namespace: assertNonEmpty(ref.namespace, "resource namespace"),
  };
}

function normalizeOwner(owner: CanvasPlacementOwner): CanvasPlacementOwner {
  if (owner.kind === "resource") {
    return resourcePlacementOwner(normalizeRef(owner.ref));
  }
  return {
    kind: "deploymentProjection",
    slotId: assertNonEmpty(owner.slotId, "deployment projection slot ID"),
    taskId: assertNonEmpty(owner.taskId, "deployment task ID"),
  };
}

function normalizeSource(
  value: CanvasLayoutNode["source"]
): CanvasLayoutNode["source"] {
  if (value === undefined || value === "generated" || value === "user") {
    return value;
  }
  throw new CanvasLayoutValidationError("source must be generated or user.");
}

function normalizeNode(node: CanvasLayoutNode): CanvasLayoutNode {
  const x = node.position.x;
  const y = node.position.y;
  if (!(Number.isFinite(x) && Number.isFinite(y))) {
    throw new CanvasLayoutValidationError("node position must be finite.");
  }
  const lastSeenUid = optionalTrimmed(node.lastSeenUid);
  const orphanedAt = normalizeOptionalTimestamp(node.orphanedAt, "orphanedAt");
  const stackOrder = normalizeOptionalStackOrder(node.stackOrder);
  const source = normalizeSource(node.source);
  const owner = normalizeOwner(canvasPlacementOwnerFromLayoutNode(node));
  if (owner.kind === "deploymentProjection") {
    return {
      ...(node.expanded === undefined ? {} : { expanded: node.expanded }),
      ...(lastSeenUid === undefined ? {} : { lastSeenUid }),
      ...(orphanedAt === undefined ? {} : { orphanedAt }),
      owner,
      position: { x, y },
      ...(source === undefined ? {} : { source }),
      ...(stackOrder === undefined ? {} : { stackOrder }),
    };
  }
  const resourceOwner = resourcePlacementOwner(normalizeRef(owner.ref));
  if (!canvasPlacementOwnersEqual(owner, resourceOwner)) {
    throw new CanvasLayoutValidationError("resource owner is invalid.");
  }
  return {
    ...(node.expanded === undefined ? {} : { expanded: node.expanded }),
    ...(lastSeenUid === undefined ? {} : { lastSeenUid }),
    ...(orphanedAt === undefined ? {} : { orphanedAt }),
    owner: resourceOwner,
    position: { x, y },
    ...(source === undefined ? {} : { source }),
    ...(stackOrder === undefined ? {} : { stackOrder }),
  };
}

function upsertNormalizedNode(
  nodesByRef: Map<string, CanvasLayoutNode>,
  order: string[],
  node: CanvasLayoutNode
): void {
  const normalized = normalizeNode(node);
  const key = canvasLayoutNodeKey(normalized);
  if (!nodesByRef.has(key)) {
    order.push(key);
  }
  nodesByRef.set(key, normalized);
}

/**
 * First placement is insert-only: an owner that already has a saved position
 * keeps it, and the write is a no-op. Concurrent clients can discover the same
 * missing node from different snapshots, so the persisted position wins and
 * the proposing client reconciles to the returned layout — a first-placement
 * patch must never rewrite user-arranged positions.
 */
function insertFirstPlacementNode(
  nodesByRef: Map<string, CanvasLayoutNode>,
  order: string[],
  node: CanvasLayoutNode
): boolean {
  const normalized = normalizeNode(node);
  const key = canvasLayoutNodeKey(normalized);
  if (nodesByRef.has(key)) {
    return false;
  }
  order.push(key);
  nodesByRef.set(key, normalized);
  return true;
}

function applyPlacementCommand(
  nodesByRef: Map<string, CanvasLayoutNode>,
  order: string[],
  command: PlacementCommand
): boolean {
  if (command.kind === "create") {
    return insertFirstPlacementNode(
      nodesByRef,
      order,
      canvasLayoutNodeFromOwner({
        owner: command.owner,
        position: command.position,
        source: command.source,
      })
    );
  }

  if (command.kind === "move") {
    const normalized = normalizeNode(
      canvasLayoutNodeFromOwner({
        owner: command.owner,
        position: command.position,
        source: command.source,
      })
    );
    const key = canvasLayoutNodeKey(normalized);
    const existing = nodesByRef.get(key);
    if (existing === undefined) {
      order.push(key);
      nodesByRef.set(key, normalized);
      return true;
    }
    nodesByRef.set(key, {
      ...existing,
      position: normalized.position,
      source: normalized.source,
    });
    return true;
  }

  if (command.kind === "delete") {
    const key = canvasPlacementOwnerKey(normalizeOwner(command.owner));
    if (!nodesByRef.has(key)) {
      return false;
    }
    nodesByRef.delete(key);
    const index = order.indexOf(key);
    if (index !== -1) {
      order.splice(index, 1);
    }
    return true;
  }

  const fromOwner = normalizeOwner(command.fromOwner);
  const toOwner = normalizeOwner(command.toOwner);
  const fromKey = canvasPlacementOwnerKey(fromOwner);
  const toKey = canvasPlacementOwnerKey(toOwner);
  const fromNode = nodesByRef.get(fromKey);
  if (fromNode === undefined) {
    return false;
  }
  if (nodesByRef.has(toKey)) {
    nodesByRef.delete(fromKey);
    const fromIndex = order.indexOf(fromKey);
    if (fromIndex !== -1) {
      order.splice(fromIndex, 1);
    }
    return true;
  }
  const rekeyed = normalizeNode({
    ...canvasLayoutNodeFromOwner({
      owner: toOwner,
      position: fromNode.position,
      source: fromNode.source,
    }),
    ...(fromNode.expanded === undefined ? {} : { expanded: fromNode.expanded }),
    ...(fromNode.lastSeenUid === undefined
      ? {}
      : { lastSeenUid: fromNode.lastSeenUid }),
    ...(fromNode.stackOrder === undefined
      ? {}
      : { stackOrder: fromNode.stackOrder }),
  });
  nodesByRef.delete(fromKey);
  nodesByRef.set(toKey, rekeyed);
  const fromIndex = order.indexOf(fromKey);
  if (fromIndex === -1) {
    order.push(toKey);
  } else {
    order[fromIndex] = toKey;
  }
  return true;
}

export function applyCanvasLayoutPatch(
  existing: CanvasLayoutDocument,
  patch: CanvasLayoutPatch,
  options?: ApplyCanvasLayoutPatchOptions
): CanvasLayoutDocument {
  const nextByRef = new Map<string, CanvasLayoutNode>();
  const order: string[] = [];

  for (const node of existing.nodes) {
    upsertNormalizedNode(nextByRef, order, node);
  }

  let firstPlacementInserted = false;
  for (const node of patch.nodes) {
    if (patch.intent === "first-placement") {
      firstPlacementInserted =
        insertFirstPlacementNode(nextByRef, order, node) ||
        firstPlacementInserted;
    } else {
      upsertNormalizedNode(nextByRef, order, node);
    }
  }

  let commandChanged = false;
  for (const command of patch.commands ?? []) {
    commandChanged =
      applyPlacementCommand(nextByRef, order, command) || commandChanged;
  }

  if (
    patch.intent === "first-placement" &&
    !firstPlacementInserted &&
    !commandChanged &&
    patch.projectNameSnapshot === undefined
  ) {
    return cleanupCanvasLayoutDocument(existing, options);
  }

  const projectNameSnapshot =
    patch.projectNameSnapshot === undefined
      ? existing.projectNameSnapshot
      : patch.projectNameSnapshot;

  const next = {
    namespace: assertNonEmpty(existing.namespace, "namespace"),
    nodes: normalizeCanvasLayoutStackOrders(
      order.flatMap((key) => {
        const node = nextByRef.get(key);
        return node === undefined ? [] : [node];
      })
    ),
    ...(projectNameSnapshot === undefined ? {} : { projectNameSnapshot }),
    projectId: assertNonEmpty(existing.projectId, "project ID"),
    version: existing.version + 1,
  };

  return cleanupCanvasLayoutDocument(next, options);
}
