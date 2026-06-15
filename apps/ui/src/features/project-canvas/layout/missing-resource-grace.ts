import type { Node } from "@xyflow/react";

import { canvasResourceIdentityFromNode } from "../nodes/resource-identity";
import {
  canvasLayoutNodeKey,
  canvasLayoutNodeResourceRef,
  canvasPlacementOwnerKey,
  resourcePlacementOwner,
} from "./placement-owner";
import type {
  CanvasLayoutDocument,
  CanvasLayoutResourceRef,
  PlacementCommand,
} from "./types";

export const CANVAS_MISSING_RESOURCE_LAYOUT_GRACE_MS = 60_000;

export interface MissingResourceLayoutGraceResult {
  deleteCommands: PlacementCommand[];
  nextMissingSinceByOwnerKey: Map<string, number>;
  retainedLayoutOwnerKeys: Set<string>;
}

function resourceOwnerKey(ref: CanvasLayoutResourceRef): string {
  return canvasPlacementOwnerKey(resourcePlacementOwner(ref));
}

function renderedResourceOwnerKeys(nodes: readonly Node[]): Set<string> {
  return new Set(
    nodes.flatMap((node) => {
      const ref = canvasResourceIdentityFromNode(node);
      return ref === undefined ? [] : [resourceOwnerKey(ref)];
    })
  );
}

export function resolveMissingResourceLayoutGrace(input: {
  graceMs?: number;
  layout: CanvasLayoutDocument | undefined;
  nodes: readonly Node[];
  nowMs?: number;
  previousMissingSinceByOwnerKey?: ReadonlyMap<string, number>;
}): MissingResourceLayoutGraceResult {
  const graceMs = input.graceMs ?? CANVAS_MISSING_RESOURCE_LAYOUT_GRACE_MS;
  const nowMs = input.nowMs ?? Date.now();
  const renderedOwnerKeys = renderedResourceOwnerKeys(input.nodes);
  const nextMissingSinceByOwnerKey = new Map<string, number>();
  const retainedLayoutOwnerKeys = new Set<string>();
  const deleteCommands: PlacementCommand[] = [];

  for (const node of input.layout?.nodes ?? []) {
    const ref = canvasLayoutNodeResourceRef(node);
    if (ref === undefined) {
      continue;
    }
    const ownerKey = canvasLayoutNodeKey(node);
    if (renderedOwnerKeys.has(ownerKey)) {
      continue;
    }

    const firstMissingAt =
      input.previousMissingSinceByOwnerKey?.get(ownerKey) ?? nowMs;
    nextMissingSinceByOwnerKey.set(ownerKey, firstMissingAt);

    if (Math.max(0, nowMs - firstMissingAt) < graceMs) {
      retainedLayoutOwnerKeys.add(ownerKey);
      continue;
    }

    deleteCommands.push({
      kind: "delete",
      owner: resourcePlacementOwner(ref),
    });
  }

  return {
    deleteCommands,
    nextMissingSinceByOwnerKey,
    retainedLayoutOwnerKeys,
  };
}
