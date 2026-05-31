import type { Node } from "@xyflow/react";
import {
  canvasResourceIdentityFromNode,
  canvasResourceKey,
} from "../nodes/resource-identity";
import {
  bringCanvasStackOrderItemToFront,
  type CanvasStackOrderItem,
  canvasStackOrderValue,
  resolveCanvasStackOrderRanks,
} from "./stack-order";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

export function canvasNodeStackOrder(node: Node): number | undefined {
  const layout = asRecord(asRecord(node.data)?.layout);
  return canvasStackOrderValue(layout?.stackOrder);
}

function canvasStackOrderItemsFromNodes(
  nodes: readonly Node[]
): CanvasStackOrderItem[] {
  return nodes.flatMap((node) => {
    const ref = canvasResourceIdentityFromNode(node);
    if (ref === undefined) {
      return [];
    }
    return [
      {
        key: node.id,
        ref,
        stackOrder: canvasNodeStackOrder(node),
      },
    ];
  });
}

export function nodeWithCanvasStackOrder(node: Node, stackOrder: number): Node {
  const data = asRecord(node.data) ?? {};
  const layout = asRecord(data.layout) ?? {};
  return {
    ...node,
    data: {
      ...data,
      layout: {
        ...layout,
        stackOrder,
      },
    },
  };
}

export function applyCanvasStackOrderToNodes(nodes: readonly Node[]): Node[] {
  const ranks = resolveCanvasStackOrderRanks(
    canvasStackOrderItemsFromNodes(nodes)
  );
  return nodes.map((node) => {
    const zIndex = ranks.get(node.id);
    return zIndex === undefined ? { ...node } : { ...node, zIndex };
  });
}

export function canvasNodeResourceStackKey(node: Node): string | undefined {
  const ref = canvasResourceIdentityFromNode(node);
  return ref === undefined ? undefined : canvasResourceKey(ref);
}

export function bringCanvasNodeToFrontInStackOrder(
  nodes: readonly Node[],
  nodeId: string
): { changed: boolean; node?: Node; nodes: Node[] } {
  const result = bringCanvasStackOrderItemToFront(
    canvasStackOrderItemsFromNodes(nodes),
    nodeId
  );
  if (!result.changed) {
    return { changed: false, nodes: applyCanvasStackOrderToNodes(nodes) };
  }

  const { stackOrder } = result;
  const nextNodes = nodes.map((node) =>
    node.id === nodeId ? nodeWithCanvasStackOrder(node, stackOrder) : node
  );
  const rankedNodes = applyCanvasStackOrderToNodes(nextNodes);
  return {
    changed: true,
    node: rankedNodes.find((node) => node.id === nodeId),
    nodes: rankedNodes,
  };
}
