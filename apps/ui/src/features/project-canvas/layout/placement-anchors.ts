import type { CanvasDetectedConnection } from "../flow/detected-connections";
import { canvasResourceKey } from "../nodes/resource-identity";
import type { CanvasLayoutResourceRef } from "./types";

export type PlacementDirection = "left" | "right";

export interface PlacementAnchor {
  direction: PlacementDirection;
  ref: CanvasLayoutResourceRef;
}

export interface PlacementAnchorIndex {
  anchorsForRef: (ref: CanvasLayoutResourceRef) => readonly PlacementAnchor[];
}

function addAnchor(
  anchorsByRef: Map<string, Map<string, PlacementAnchor>>,
  owner: CanvasLayoutResourceRef,
  anchor: PlacementAnchor
): void {
  const ownerKey = canvasResourceKey(owner);
  const anchorKey = canvasResourceKey(anchor.ref);
  const anchors =
    anchorsByRef.get(ownerKey) ?? new Map<string, PlacementAnchor>();
  anchors.set(anchorKey, anchor);
  anchorsByRef.set(ownerKey, anchors);
}

function sortedAnchors(
  anchors: Iterable<PlacementAnchor> | undefined
): PlacementAnchor[] {
  return Array.from(anchors ?? []).sort((a, b) =>
    canvasResourceKey(a.ref).localeCompare(canvasResourceKey(b.ref))
  );
}

export function createPlacementAnchorIndex(
  connections: readonly CanvasDetectedConnection[] | undefined
): PlacementAnchorIndex {
  const anchorsByRef = new Map<string, Map<string, PlacementAnchor>>();
  const sortedByRef = new Map<string, PlacementAnchor[]>();

  for (const connection of connections ?? []) {
    if (connection.kind !== "APToDB") {
      continue;
    }
    if (connection.source.kind === "AP" && connection.target.kind === "DB") {
      addAnchor(anchorsByRef, connection.source, {
        direction: "left",
        ref: connection.target,
      });
      addAnchor(anchorsByRef, connection.target, {
        direction: "right",
        ref: connection.source,
      });
    }
  }

  for (const [key, anchors] of anchorsByRef) {
    sortedByRef.set(key, sortedAnchors(anchors.values()));
  }

  return {
    anchorsForRef: (ref) => sortedByRef.get(canvasResourceKey(ref)) ?? [],
  };
}
