"use client";

import { Canvas } from "@workspace/ui/components/canvas/canvas";
import type { CanvasMeta } from "@workspace/ui/components/canvas/canvas.types";
import type { ContainerNodeStates } from "@workspace/ui/components/container-node/container-node";
import { ContainerNode } from "@workspace/ui/components/container-node/container-node";
import { Preview, PreviewWrapper } from "@workspace/ui/components/preview";
import {
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
  ReactFlowProvider,
} from "@xyflow/react";
import { memo, useCallback, useMemo, useState } from "react";

interface CanvasContainerNodeData extends Record<string, unknown> {
  defaultExpanded?: boolean;
  states: ContainerNodeStates;
}

const PreviewCanvasContainerNode = memo(function PreviewCanvasContainerNode({
  data,
  dragging,
  selected,
}: NodeProps<Node<CanvasContainerNodeData, "containerNode">>) {
  return (
    <ContainerNode.Root
      defaultExpanded={data.defaultExpanded}
      interaction={{ dragging, selected }}
      lifecycleActions={{
        delete: { disabled: true },
        restart: { disabled: true },
        start: { disabled: true },
        stop: { disabled: true },
      }}
      quickActions={{
        calendar: { disabled: true },
        terminal: { disabled: true },
        logs: { disabled: true },
        metrics: { disabled: true },
      }}
      states={data.states}
    >
      <ContainerNode.Content />
    </ContainerNode.Root>
  );
});

PreviewCanvasContainerNode.displayName = "PreviewCanvasContainerNode";

const containerCanvasStatesPrimary: ContainerNodeStates = {
  image: "registry.example.io/demo:v2",
  kind: "AP",
  metrics: {
    cpu: 42,
    memory: 58,
  },
  name: "workload-demo-001",
  replicas: 3,
  status: { label: "Running", tone: "running" },
  uid: "preview-uid-primary",
};

const containerCanvasStatesSecondary: ContainerNodeStates = {
  image: "registry.example.io/other:v5",
  kind: "AP",
  metrics: {
    cpu: 18,
    memory: 31,
  },
  name: "workload-demo-002",
  replicas: 1,
  status: { label: "Synced", tone: "running" },
  uid: "preview-uid-secondary",
};

/** Frozen graph preview data (mirrors `useProjectServices` canvas output without fetch). */
const CANVAS_PREVIEW_GRAPH_NODES: Node<
  CanvasContainerNodeData,
  "containerNode"
>[] = [
  {
    data: { defaultExpanded: true, states: containerCanvasStatesPrimary },
    id: "container-1",
    position: { x: 72, y: 56 },
    type: "containerNode",
  },
  {
    data: { states: containerCanvasStatesSecondary },
    id: "container-2",
    position: { x: 392, y: 56 },
    type: "containerNode",
  },
];

const CANVAS_PREVIEW_GRAPH_EDGES: Edge[] = [
  {
    id: "preview-edge-1",
    source: "container-1",
    target: "container-2",
  },
];

const CANVAS_PREVIEW_NODE_TYPES = {
  containerNode: PreviewCanvasContainerNode,
} as const satisfies NodeTypes;

/** Local-only selection logic (production uses URL + `useCanvasMeta`). */
function useCanvasPreviewSelection(
  nodes: readonly Node[],
  edges: readonly Edge[]
) {
  const [selectedEdge, setSelectedEdge] = useState<Edge | null>(null);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);

  const setSelection = useCallback((node: Node | null, edge: Edge | null) => {
    setSelectedNode(node);
    setSelectedEdge(edge);
  }, []);

  const canvasMeta = useMemo((): CanvasMeta => {
    return {
      nodeTypes: CANVAS_PREVIEW_NODE_TYPES,
      reactFlowProps: {
        onEdgeClick: (_event, edge) => {
          setSelection(null, edge);
        },
        onNodeClick: (_event, node) => {
          setSelection(node, null);
        },
        onPaneClick: () => {
          setSelection(null, null);
        },
      },
    };
  }, [setSelection]);

  const canvasState = useMemo(
    () => ({
      edges: [...edges],
      nodes: [...nodes],
      selectedEdge,
      selectedNode,
    }),
    [edges, nodes, selectedEdge, selectedNode]
  );

  return {
    canvasMeta,
    canvasState,
  };
}

export default function CanvasPreview() {
  const { canvasMeta, canvasState } = useCanvasPreviewSelection(
    CANVAS_PREVIEW_GRAPH_NODES,
    CANVAS_PREVIEW_GRAPH_EDGES
  );

  return (
    <PreviewWrapper className="lg:grid-cols-1">
      <Preview
        className="h-[min(480px,70vh)]"
        showMaximize
        title="Workspace canvas"
      >
        <ReactFlowProvider>
          <div className="relative size-full overflow-hidden rounded-xl border border-border">
            <Canvas.Root meta={canvasMeta} state={canvasState}>
              <Canvas.Flow />
            </Canvas.Root>
          </div>
        </ReactFlowProvider>
      </Preview>
    </PreviewWrapper>
  );
}
