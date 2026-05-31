import type { Node } from "@xyflow/react";

import {
  canvasEntryPointApResourceIdentityFromNode,
  canvasResourceIdentityFromNode,
  canvasResourceKey,
} from "../nodes/resource-identity";
import type {
  CanvasLayoutDocument,
  CanvasLayoutPosition,
  CanvasLayoutResourceRef,
} from "./types";

export const CANVAS_NODE_FALLBACK_WIDTH = 272;
export const CANVAS_NODE_FALLBACK_HEIGHT = 62;

const FALLBACK_COLUMNS = 3;
const FALLBACK_COL_GAP = 340;
const FALLBACK_ROW_GAP = 280;
const ENTRY_POINT_AP_LEFT_OFFSET = 340;
const GENERATED_POSITION_SOURCE = "generated";

export interface PlaceCanvasNodesOptions {
  layout: CanvasLayoutDocument | undefined;
  nodes: Node[];
}

interface CanvasNodeRect {
  height: number;
  width: number;
  x: number;
  y: number;
}

interface PlacementCandidate {
  index: number;
  node: Node;
  ref: CanvasLayoutResourceRef | undefined;
  sortKey: string;
}

function fallbackCanvasPosition(index: number): CanvasLayoutPosition {
  return {
    x: (index % FALLBACK_COLUMNS) * FALLBACK_COL_GAP,
    y: Math.floor(index / FALLBACK_COLUMNS) * FALLBACK_ROW_GAP,
  };
}

function rectFromPosition(position: CanvasLayoutPosition): CanvasNodeRect {
  return {
    height: CANVAS_NODE_FALLBACK_HEIGHT,
    width: CANVAS_NODE_FALLBACK_WIDTH,
    x: position.x,
    y: position.y,
  };
}

function rectsIntersect(a: CanvasNodeRect, b: CanvasNodeRect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

export function isCanvasNodeGeneratedPosition(node: Node | undefined): boolean {
  const layout = asRecord(asRecord(node?.data)?.layout);
  return layout?.positionSource === GENERATED_POSITION_SOURCE;
}

function comparePlacementCandidates(
  a: PlacementCandidate,
  b: PlacementCandidate
): number {
  return a.sortKey.localeCompare(b.sortKey);
}

function nodeWithPosition(node: Node, position: CanvasLayoutPosition): Node {
  return {
    ...node,
    position: { x: position.x, y: position.y },
  };
}

function nodeWithGeneratedPosition(
  node: Node,
  position: CanvasLayoutPosition
): Node {
  const data = asRecord(node.data) ?? {};
  const layout = asRecord(data.layout) ?? {};
  return {
    ...nodeWithPosition(node, position),
    data: {
      ...data,
      layout: {
        ...layout,
        generatedPosition: { x: position.x, y: position.y },
        positionSource: GENERATED_POSITION_SOURCE,
      },
    },
  };
}

function firstOpenFallbackPosition(
  allocated: readonly CanvasNodeRect[]
): CanvasLayoutPosition {
  let index = 0;
  while (true) {
    const position = fallbackCanvasPosition(index);
    const candidate = rectFromPosition(position);
    if (!allocated.some((rect) => rectsIntersect(candidate, rect))) {
      return position;
    }
    index += 1;
  }
}

export function placeCanvasNodes({
  layout,
  nodes,
}: PlaceCanvasNodesOptions): Node[] {
  const savedByRef = new Map(
    (layout?.nodes ?? []).map((node) => [
      canvasResourceKey(node.ref),
      node.position,
    ])
  );
  const positionByRef = new Map(savedByRef);
  const allocated = Array.from(savedByRef.values()).map(rectFromPosition);
  const placedNodes = nodes.map((node) => ({ ...node }));
  const rasterCandidates: PlacementCandidate[] = [];
  const entryPointCandidates: PlacementCandidate[] = [];

  placedNodes.forEach((node, index) => {
    const ref = canvasResourceIdentityFromNode(node);
    const key = ref === undefined ? undefined : canvasResourceKey(ref);
    const savedPosition = key === undefined ? undefined : savedByRef.get(key);
    if (savedPosition !== undefined) {
      placedNodes[index] = nodeWithPosition(node, savedPosition);
      return;
    }

    const candidate = {
      index,
      node,
      ref,
      sortKey: key ?? `Unknown:${index}:${node.id}`,
    };
    if (ref?.kind === "EntryPoint") {
      entryPointCandidates.push(candidate);
    } else {
      rasterCandidates.push(candidate);
    }
  });

  for (const candidate of [...rasterCandidates].sort(
    comparePlacementCandidates
  )) {
    const position = firstOpenFallbackPosition(allocated);
    allocated.push(rectFromPosition(position));
    placedNodes[candidate.index] = nodeWithGeneratedPosition(
      candidate.node,
      position
    );
    if (candidate.ref !== undefined) {
      positionByRef.set(canvasResourceKey(candidate.ref), position);
    }
  }

  for (const candidate of [...entryPointCandidates].sort(
    comparePlacementCandidates
  )) {
    const apRef = canvasEntryPointApResourceIdentityFromNode(candidate.node);
    const apPosition =
      apRef === undefined
        ? undefined
        : positionByRef.get(canvasResourceKey(apRef));
    const position =
      apPosition === undefined
        ? firstOpenFallbackPosition(allocated)
        : { x: apPosition.x - ENTRY_POINT_AP_LEFT_OFFSET, y: apPosition.y };

    placedNodes[candidate.index] = nodeWithGeneratedPosition(
      candidate.node,
      position
    );
  }

  return placedNodes;
}
