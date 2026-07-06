import type { Node, NodeChange } from "@xyflow/react";

import type { CanvasDetectedConnection } from "../flow/detected-connections";
import { canvasLayoutNodeFromNode } from "./merge";
import { placeCanvasNodesWithLayout } from "./placement";
import { canvasLayoutNodeKey } from "./placement-owner";
import type { CanvasLayoutNode } from "./types";

export interface CanvasAutoLayoutResult {
  /** Regenerated Canvas Layout entries to persist, one per placement owner. */
  layoutNodes: CanvasLayoutNode[];
  /** React Flow position changes that move rendered nodes to the new layout. */
  positionChanges: NodeChange[];
}

/**
 * Whole-canvas auto-layout: regenerates a Generated Canvas Position for every
 * rendered node, ignoring existing Canvas Layout positions. Unlike
 * Incremental Canvas Placement this intentionally reinterprets user-arranged
 * structure, so it must only run from an explicit user gesture. Expansion,
 * stack order, and resource identity carry over; only positions change.
 */
export function autoLayoutCanvasNodes(input: {
  connections?: readonly CanvasDetectedConnection[];
  nodes: readonly Node[];
}): CanvasAutoLayoutResult {
  const { nodes: placedNodes, placedLayoutNodes } = placeCanvasNodesWithLayout({
    connections: input.connections,
    layout: undefined,
    nodes: [...input.nodes],
  });

  const positionChanges: NodeChange[] = [];
  placedNodes.forEach((node, index) => {
    const current = input.nodes[index];
    if (
      current === undefined ||
      (node.position.x === current.position.x &&
        node.position.y === current.position.y)
    ) {
      return;
    }
    positionChanges.push({
      id: node.id,
      position: { x: node.position.x, y: node.position.y },
      type: "position",
    });
  });

  const placedOwnerKeys = new Set(placedLayoutNodes.map(canvasLayoutNodeKey));
  const layoutNodes = placedNodes.flatMap((node) => {
    const layoutNode = canvasLayoutNodeFromNode(node, { source: "generated" });
    return layoutNode !== undefined &&
      placedOwnerKeys.has(canvasLayoutNodeKey(layoutNode))
      ? [layoutNode]
      : [];
  });

  return { layoutNodes, positionChanges };
}
