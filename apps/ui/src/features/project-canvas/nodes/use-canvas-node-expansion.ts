"use client";

import type { Node } from "@xyflow/react";
import { useCallback, useEffect, useState } from "react";

import { useProjectCanvasNodeCommands } from "@/features/project-canvas/workbench/node-commands-react";
import { CANVAS_RESOURCE_NODE_DEFAULT_EXPANDED } from "./constants";
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
  const commands = useProjectCanvasNodeCommands();
  const defaultExpanded =
    data.layout?.expanded ?? CANVAS_RESOURCE_NODE_DEFAULT_EXPANDED;
  const [expandedState, setExpandedState] = useState(defaultExpanded);
  useEffect(() => {
    setExpandedState((current) =>
      current === defaultExpanded ? current : defaultExpanded
    );
  }, [defaultExpanded]);

  const onExpandedChange = useCallback(
    (expanded: boolean) => {
      setExpandedState((current) =>
        current === expanded ? current : expanded
      );
      const fallbackNode: Node = {
        data,
        id,
        position: { x: positionAbsoluteX, y: positionAbsoluteY },
        type,
      };
      const node = nodeWithExpandedState(
        commands?.getNodes().find((candidate) => candidate.id === id) ??
          fallbackNode,
        expanded,
        data
      );
      if (commands != null && !commands.readOnly) {
        commands.commitNodeLayout(node);
      }
    },
    [commands, data, id, positionAbsoluteX, positionAbsoluteY, type]
  );

  return { defaultExpanded, expanded: expandedState, onExpandedChange };
}
