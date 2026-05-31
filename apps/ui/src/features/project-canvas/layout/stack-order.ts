import type { CanvasLayoutNode, CanvasLayoutResourceRef } from "./types";

export const CANVAS_STACK_ORDER_RETURN_STABILITY_MS = 10_000;

export interface CanvasStackOrderItem {
  key: string;
  ref: CanvasLayoutResourceRef;
  stackOrder?: number;
}

export type BringCanvasStackOrderItemToFrontResult =
  | { changed: false; stackOrder?: never }
  | { changed: true; stackOrder: number };

const DEFAULT_LAYER_BY_KIND: Record<CanvasLayoutResourceRef["kind"], number> = {
  AP: 0,
  DB: 1,
  EntryPoint: 2,
};

export function canvasStackOrderValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value)
    ? value
    : undefined;
}

function defaultCanvasStackLayer(ref: CanvasLayoutResourceRef): number {
  return DEFAULT_LAYER_BY_KIND[ref.kind];
}

function compareImplicitStackItems(
  a: CanvasStackOrderItem,
  b: CanvasStackOrderItem
): number {
  return defaultCanvasStackLayer(a.ref) - defaultCanvasStackLayer(b.ref);
}

export function resolveCanvasStackOrderRanks(
  items: readonly CanvasStackOrderItem[]
): Map<string, number> {
  const withIndex = items.map((item, index) => ({ index, item }));
  const sorted = [...withIndex].sort((a, b) => {
    const aStackOrder = canvasStackOrderValue(a.item.stackOrder);
    const bStackOrder = canvasStackOrderValue(b.item.stackOrder);
    if (aStackOrder === undefined && bStackOrder === undefined) {
      const implicitDiff = compareImplicitStackItems(a.item, b.item);
      return implicitDiff === 0 ? a.index - b.index : implicitDiff;
    }
    if (aStackOrder === undefined) {
      return -1;
    }
    if (bStackOrder === undefined) {
      return 1;
    }
    const rankDiff = aStackOrder - bStackOrder;
    return rankDiff === 0 ? a.index - b.index : rankDiff;
  });

  return new Map(sorted.map(({ item }, rank) => [item.key, rank]));
}

export function nextExplicitCanvasStackOrder(
  items: readonly { stackOrder?: number }[]
): number {
  return (
    items.reduce((max, item) => {
      const stackOrder = canvasStackOrderValue(item.stackOrder);
      return stackOrder === undefined ? max : Math.max(max, stackOrder);
    }, -1) + 1
  );
}

export function bringCanvasStackOrderItemToFront(
  items: readonly CanvasStackOrderItem[],
  key: string
): BringCanvasStackOrderItemToFrontResult {
  const ranks = resolveCanvasStackOrderRanks(items);
  const currentRank = ranks.get(key);
  if (currentRank === undefined) {
    return { changed: false };
  }
  const topRank = Math.max(...ranks.values());
  if (currentRank === topRank) {
    return { changed: false };
  }

  return { changed: true, stackOrder: nextExplicitCanvasStackOrder(items) };
}

function canvasLayoutNodeWithStackOrder(
  node: CanvasLayoutNode,
  stackOrder: number | undefined
): CanvasLayoutNode {
  const { stackOrder: _ignored, ...rest } = node;
  return stackOrder === undefined ? rest : { ...rest, stackOrder };
}

export function normalizeCanvasLayoutStackOrders(
  nodes: readonly CanvasLayoutNode[]
): CanvasLayoutNode[] {
  const explicit = nodes
    .map((node, index) => ({
      index,
      node,
      stackOrder: canvasStackOrderValue(node.stackOrder),
    }))
    .filter(
      (
        item
      ): item is {
        index: number;
        node: CanvasLayoutNode;
        stackOrder: number;
      } => item.stackOrder !== undefined
    )
    .sort((a, b) => {
      const rankDiff = a.stackOrder - b.stackOrder;
      return rankDiff === 0 ? a.index - b.index : rankDiff;
    });
  const normalizedByIndex = new Map<number, number>();
  explicit.forEach((item, stackOrder) => {
    normalizedByIndex.set(item.index, stackOrder);
  });

  return nodes.map((node, index) => {
    return canvasLayoutNodeWithStackOrder(node, normalizedByIndex.get(index));
  });
}
