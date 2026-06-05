"use client";

import { type Node, useReactFlow } from "@xyflow/react";
import { useCallback, useEffect, useState } from "react";

import type { CanvasNodeLayoutState } from "./types";

interface UseCanvasNodeExpansionOptions {
  data: Record<string, unknown> & {
    layout?: CanvasNodeLayoutState;
  };
  id: string;
  positionAbsoluteX: number;
  positionAbsoluteY: number;
  type: string;
}

function layoutFromData(
  data: Record<string, unknown> | undefined
): CanvasNodeLayoutState {
  const layout = data?.layout;
  return layout != null && typeof layout === "object"
    ? (layout as CanvasNodeLayoutState)
    : {};
}

function nodeWithExpandedState(
  node: Node,
  expanded: boolean,
  fallbackData: UseCanvasNodeExpansionOptions["data"]
): Node {
  const data = {
    ...fallbackData,
    ...node.data,
  };
  return {
    ...node,
    data: {
      ...data,
      layout: {
        ...layoutFromData(data),
        expanded,
      },
    },
  };
}

export function useCanvasNodeExpansion({
  data,
  id,
  positionAbsoluteX,
  positionAbsoluteY,
  type,
}: UseCanvasNodeExpansionOptions) {
  const { getNode, updateNodeData } = useReactFlow<Node>();
  const defaultExpanded = data.layout?.expanded ?? false;
  const [expandedState, setExpandedState] = useState(defaultExpanded);
  useEffect(() => {
    setExpandedState(defaultExpanded);
  }, [defaultExpanded]);

  const onExpandedChange = useCallback(
    (expanded: boolean) => {
      setExpandedState(expanded);
      updateNodeData(id, (node) => {
        const nodeData = node.data as Record<string, unknown>;
        return {
          layout: {
            ...layoutFromData(nodeData),
            expanded,
          },
        };
      });

      const fallbackNode: Node = {
        data,
        id,
        position: { x: positionAbsoluteX, y: positionAbsoluteY },
        type,
      };
      const node = nodeWithExpandedState(
        getNode(id) ?? fallbackNode,
        expanded,
        data
      );
      const layout = layoutFromData(data);
      layout.onExpandedChange?.(node, expanded);
    },
    [
      data,
      getNode,
      id,
      positionAbsoluteX,
      positionAbsoluteY,
      type,
      updateNodeData,
    ]
  );

  return { defaultExpanded, expanded: expandedState, onExpandedChange };
}
