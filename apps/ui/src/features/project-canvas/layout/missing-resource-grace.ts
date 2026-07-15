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

function resourceIdentityOwnerKeys(
  resourceIdentities: readonly CanvasLayoutResourceRef[]
): Set<string> {
  return new Set(resourceIdentities.map(resourceOwnerKey));
}

export function resolveMissingResourceLayoutGrace(input: {
  graceMs?: number;
  layout: CanvasLayoutDocument | undefined;
  nowMs?: number;
  previousMissingSinceByOwnerKey?: ReadonlyMap<string, number>;
  resourceIdentities: readonly CanvasLayoutResourceRef[];
}): MissingResourceLayoutGraceResult {
  const graceMs = input.graceMs ?? CANVAS_MISSING_RESOURCE_LAYOUT_GRACE_MS;
  const nowMs = input.nowMs ?? Date.now();
  const runtimeOwnerKeys = resourceIdentityOwnerKeys(input.resourceIdentities);
  const nextMissingSinceByOwnerKey = new Map<string, number>();
  const retainedLayoutOwnerKeys = new Set<string>();
  const deleteCommands: PlacementCommand[] = [];

  for (const node of input.layout?.nodes ?? []) {
    const ref = canvasLayoutNodeResourceRef(node);
    if (ref === undefined) {
      continue;
    }
    const ownerKey = canvasLayoutNodeKey(node);
    if (runtimeOwnerKeys.has(ownerKey)) {
      continue;
    }

    const firstMissingAt =
      input.previousMissingSinceByOwnerKey?.get(ownerKey) ?? nowMs;
    nextMissingSinceByOwnerKey.set(ownerKey, firstMissingAt);

    if (Math.max(0, nowMs - firstMissingAt) <= graceMs) {
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
