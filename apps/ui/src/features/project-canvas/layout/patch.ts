import { canvasResourceKey } from "../nodes/resource-identity";
import { cleanupCanvasLayoutDocument } from "./cleanup";
import {
  canvasStackOrderValue,
  normalizeCanvasLayoutStackOrders,
} from "./stack-order";
import type {
  CanvasLayoutDocument,
  CanvasLayoutNode,
  CanvasLayoutPatch,
  CanvasLayoutResourceRef,
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

function normalizeNode(node: CanvasLayoutNode): CanvasLayoutNode {
  const x = node.position.x;
  const y = node.position.y;
  if (!(Number.isFinite(x) && Number.isFinite(y))) {
    throw new CanvasLayoutValidationError("node position must be finite.");
  }
  const lastSeenUid = optionalTrimmed(node.lastSeenUid);
  const orphanedAt = normalizeOptionalTimestamp(node.orphanedAt, "orphanedAt");
  const stackOrder = normalizeOptionalStackOrder(node.stackOrder);
  return {
    ...(node.expanded === undefined ? {} : { expanded: node.expanded }),
    ...(lastSeenUid === undefined ? {} : { lastSeenUid }),
    ...(orphanedAt === undefined ? {} : { orphanedAt }),
    position: { x, y },
    ref: normalizeRef(node.ref),
    ...(stackOrder === undefined ? {} : { stackOrder }),
  };
}

function upsertNormalizedNode(
  nodesByRef: Map<string, CanvasLayoutNode>,
  order: string[],
  node: CanvasLayoutNode
): void {
  const normalized = normalizeNode(node);
  const key = canvasResourceKey(normalized.ref);
  if (!nodesByRef.has(key)) {
    order.push(key);
  }
  nodesByRef.set(key, normalized);
}

function insertFirstPlacementNode(
  nodesByRef: Map<string, CanvasLayoutNode>,
  order: string[],
  node: CanvasLayoutNode
): boolean {
  const normalized = normalizeNode(node);
  const key = canvasResourceKey(normalized.ref);
  if (nodesByRef.has(key)) {
    return false;
  }
  order.push(key);
  nodesByRef.set(key, normalized);
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

  if (
    patch.intent === "first-placement" &&
    !firstPlacementInserted &&
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
