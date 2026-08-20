"use client";

import { Canvas } from "@workspace/ui/components/canvas/canvas";
import type { CanvasMeta } from "@workspace/ui/components/canvas/canvas.types";
import type {
  ContainerNodeLifecycleActions,
  ContainerNodeQuickActions,
  ContainerNodeStates,
} from "@workspace/ui/components/container-node/container-node";
import { ContainerNode } from "@workspace/ui/components/container-node/container-node";
import type { Edge, Node, NodeProps, NodeTypes } from "@xyflow/react";
import { memo, useMemo } from "react";

interface CanvasContainerNodeData extends Record<string, unknown> {
  defaultExpanded: boolean;
  states: ContainerNodeStates;
}

const PREVIEW_LIFECYCLE_ACTIONS = {
  delete: { onClick: () => undefined },
  restart: { onClick: () => undefined },
  start: { onClick: () => undefined },
  stop: { onClick: () => undefined },
} as const satisfies ContainerNodeLifecycleActions;

const PREVIEW_QUICK_ACTIONS = {
  imageVersions: { onClick: () => undefined },
  terminal: { onClick: () => undefined },
  logs: { onClick: () => undefined },
  metrics: { onClick: () => undefined },
} as const satisfies ContainerNodeQuickActions;

const PreviewCanvasContainerNode = memo(function PreviewCanvasContainerNode({
  data,
  dragging,
  selected,
}: NodeProps<Node<CanvasContainerNodeData, "containerNode">>) {
  return (
    <ContainerNode.Root
      defaultExpanded={data.defaultExpanded}
      interaction={{ dragging, selected }}
      lifecycleActions={PREVIEW_LIFECYCLE_ACTIONS}
      quickActions={PREVIEW_QUICK_ACTIONS}
      states={data.states}
    >
      <ContainerNode.Content />
    </ContainerNode.Root>
  );
});

PreviewCanvasContainerNode.displayName = "PreviewCanvasContainerNode";

const runningStates: ContainerNodeStates = {
  image: "registry.example.io/api:v2",
  kind: "AP",
  metrics: {
    cpu: 38,
    memory: 61,
  },
  name: "api-running",
  readyReplicas: 3,
  replicas: 3,
  status: { label: "Running", tone: "running" },
};

const pausedStates: ContainerNodeStates = {
  image: "registry.example.io/worker:v1",
  kind: "AP",
  name: "worker-paused",
  readyReplicas: 0,
  replicas: 0,
  status: { label: "Paused", tone: "paused" },
};

const CONTAINER_NODE_CANVAS_NODES: Node<
  CanvasContainerNodeData,
  "containerNode"
>[] = [
  {
    data: { defaultExpanded: false, states: runningStates },
    id: "container-node-collapsed",
    position: { x: 180, y: 130 },
    type: "containerNode",
  },
  {
    data: { defaultExpanded: true, states: pausedStates },
    id: "container-node-expanded",
    position: { x: 560, y: 120 },
    type: "containerNode",
  },
];

const CONTAINER_NODE_CANVAS_EDGES: Edge[] = [];

const CONTAINER_NODE_CANVAS_NODE_TYPES = {
  containerNode: PreviewCanvasContainerNode,
} as const satisfies NodeTypes;

export function ContainerNodeCanvasHero() {
  const canvasMeta = useMemo(
    (): CanvasMeta => ({
      nodeTypes: CONTAINER_NODE_CANVAS_NODE_TYPES,
      reactFlowProps: {
        fitViewOptions: { padding: 0.45 },
      },
    }),
    []
  );

  const canvasState = useMemo(
    () => ({
      edges: CONTAINER_NODE_CANVAS_EDGES,
      nodes: CONTAINER_NODE_CANVAS_NODES,
      selectedEdge: null,
      selectedNode: null,
    }),
    []
  );

  return (
    <div className="relative size-full overflow-hidden rounded-xl border border-border">
      <Canvas.Root meta={canvasMeta} state={canvasState}>
        <Canvas.Flow />
      </Canvas.Root>
    </div>
  );
}
