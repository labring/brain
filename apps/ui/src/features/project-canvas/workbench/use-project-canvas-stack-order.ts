"use client";

import type { Node } from "@xyflow/react";
import { useMemo, useState } from "react";
import {
  applyCanvasStackOrderToNodes,
  bringCanvasNodeToFrontInStackOrder,
  canvasNodeResourceStackKey,
  canvasNodeStackOrder,
  nodeWithCanvasStackOrder,
} from "@/features/project-canvas/layout/node-stack-order";
import { useStableCallback } from "@/features/project-canvas/use-stable-callback";

export function useProjectCanvasStackOrder({
  nodes,
  onNodeStackOrderChange,
  readOnly,
}: {
  nodes: Node[];
  onNodeStackOrderChange?: (node: Node) => void;
  readOnly: boolean;
}) {
  const [localStackOrderByRef, setLocalStackOrderByRef] = useState<
    ReadonlyMap<string, number>
  >(() => new Map());

  const stackOrderedNodes = useMemo(() => {
    const overridden = nodes.map((node) => {
      const key = canvasNodeResourceStackKey(node);
      const stackOrder =
        key === undefined ? undefined : localStackOrderByRef.get(key);
      return stackOrder === undefined
        ? node
        : nodeWithCanvasStackOrder(node, stackOrder);
    });
    return applyCanvasStackOrderToNodes(overridden);
  }, [localStackOrderByRef, nodes]);

  const frontCanvasNode = useStableCallback(
    (node: Node, options?: { persist?: boolean }) => {
      const sourceNodes = stackOrderedNodes.map((candidate) =>
        candidate.id === node.id
          ? { ...candidate, position: { ...node.position } }
          : candidate
      );
      const result = bringCanvasNodeToFrontInStackOrder(sourceNodes, node.id);
      const nextNode = result.node;
      if (!result.changed || nextNode === undefined) {
        return;
      }

      const key = canvasNodeResourceStackKey(nextNode);
      const stackOrder = canvasNodeStackOrder(nextNode);
      if (key !== undefined && stackOrder !== undefined) {
        setLocalStackOrderByRef((current) => {
          if (current.get(key) === stackOrder) {
            return current;
          }
          const next = new Map(current);
          next.set(key, stackOrder);
          return next;
        });
      }

      if (!readOnly && options?.persist !== false) {
        onNodeStackOrderChange?.(nextNode);
      }
      return nextNode;
    }
  );

  const bringNodeToFrontById = useStableCallback((nodeId: string) => {
    const node = stackOrderedNodes.find((candidate) => candidate.id === nodeId);
    if (node !== undefined) {
      frontCanvasNode(node);
    }
  });

  return {
    bringNodeToFrontById,
    frontCanvasNode,
    stackOrderedNodes,
  };
}
