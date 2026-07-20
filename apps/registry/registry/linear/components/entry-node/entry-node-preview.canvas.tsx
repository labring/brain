"use client";

import { Canvas } from "@workspace/ui/components/canvas/canvas";
import type { CanvasMeta } from "@workspace/ui/components/canvas/canvas.types";
import type {
  EntryNodeAccessDomain,
  EntryNodeStates,
  EntryNodeTarget,
} from "@workspace/ui/components/entry-node/entry-node";
import { EntryNode } from "@workspace/ui/components/entry-node/entry-node";
import type { Edge, Node, NodeProps, NodeTypes } from "@xyflow/react";
import { memo, useMemo } from "react";

interface CanvasEntryNodeData extends Record<string, unknown> {
  accessDomain: EntryNodeAccessDomain;
  defaultExpanded: boolean;
  states: EntryNodeStates;
  targets: EntryNodeTarget[];
}

const PreviewCanvasEntryNode = memo(function PreviewCanvasEntryNode({
  data,
  dragging,
  selected,
}: NodeProps<Node<CanvasEntryNodeData, "entryNode">>) {
  return (
    <EntryNode.Root
      accessDomain={data.accessDomain}
      defaultExpanded={data.defaultExpanded}
      interaction={{ dragging, selected }}
      states={data.states}
      targets={data.targets}
    >
      <EntryNode.Content />
    </EntryNode.Root>
  );
});

PreviewCanvasEntryNode.displayName = "PreviewCanvasEntryNode";

const entryNodeStates: EntryNodeStates = {
  name: "orders.demo.sealos.run",
};

const accessDomain: EntryNodeAccessDomain = {
  value: "orders.demo.sealos.run",
};

const targets: EntryNodeTarget[] = [
  {
    id: "public",
    label: "Platform Address",
    status: { label: "Accessible", tone: "accessible" },
    value: "https://orders.demo.sealos.run/",
  },
];

const ENTRY_NODE_CANVAS_NODES: Node<CanvasEntryNodeData, "entryNode">[] = [
  {
    data: {
      accessDomain,
      defaultExpanded: false,
      states: entryNodeStates,
      targets,
    },
    id: "entry-node-collapsed",
    position: { x: 180, y: 140 },
    type: "entryNode",
  },
  {
    data: {
      accessDomain,
      defaultExpanded: true,
      states: entryNodeStates,
      targets,
    },
    id: "entry-node-expanded",
    position: { x: 560, y: 130 },
    type: "entryNode",
  },
];

const ENTRY_NODE_CANVAS_EDGES: Edge[] = [];

const ENTRY_NODE_CANVAS_NODE_TYPES = {
  entryNode: PreviewCanvasEntryNode,
} as const satisfies NodeTypes;

export function EntryNodeCanvasHero() {
  const canvasMeta = useMemo(
    (): CanvasMeta => ({
      nodeTypes: ENTRY_NODE_CANVAS_NODE_TYPES,
      reactFlowProps: {
        fitViewOptions: { padding: 0.45 },
      },
    }),
    []
  );

  const canvasState = useMemo(
    () => ({
      edges: ENTRY_NODE_CANVAS_EDGES,
      nodes: ENTRY_NODE_CANVAS_NODES,
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
