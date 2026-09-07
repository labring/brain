"use client";

import { Canvas } from "@workspace/ui/components/canvas/canvas";
import type { CanvasMeta } from "@workspace/ui/components/canvas/canvas.types";
import type {
  EntryNodeGroup,
  EntryNodeStates,
} from "@workspace/ui/components/entry-node/entry-node";
import { EntryNode } from "@workspace/ui/components/entry-node/entry-node";
import type { Edge, Node, NodeProps, NodeTypes } from "@xyflow/react";
import { memo, useMemo } from "react";

interface CanvasEntryNodeData extends Record<string, unknown> {
  defaultExpanded: boolean;
  groups: EntryNodeGroup[];
  states: EntryNodeStates;
}

const PreviewCanvasEntryNode = memo(function PreviewCanvasEntryNode({
  data,
  dragging,
  selected,
}: NodeProps<Node<CanvasEntryNodeData, "entryNode">>) {
  return (
    <EntryNode.Root
      defaultExpanded={data.defaultExpanded}
      groups={data.groups}
      interaction={{ dragging, selected }}
      states={data.states}
    >
      <EntryNode.Content />
    </EntryNode.Root>
  );
});

PreviewCanvasEntryNode.displayName = "PreviewCanvasEntryNode";

const entryNodeStates: EntryNodeStates = {
  name: "orders",
};

const PLATFORM_SUFFIX = ".demo.sealos.run";

const singlePortGroups: EntryNodeGroup[] = [
  {
    addresses: [
      {
        host: `orders${PLATFORM_SUFFIX}`,
        hostSuffix: PLATFORM_SUFFIX,
        id: "public",
        status: { label: "Accessible", tone: "accessible" },
        value: `https://orders${PLATFORM_SUFFIX}/`,
      },
    ],
    port: 3000,
  },
];

const twoPortGroups: EntryNodeGroup[] = [
  {
    addresses: [
      {
        host: `game${PLATFORM_SUFFIX}`,
        hostSuffix: PLATFORM_SUFFIX,
        id: "game",
        status: { label: "Accessible", tone: "accessible" },
        value: `wss://game${PLATFORM_SUFFIX}/`,
      },
    ],
    name: "game",
    port: 5200,
  },
  {
    addresses: [
      {
        host: `game-admin${PLATFORM_SUFFIX}`,
        hostSuffix: PLATFORM_SUFFIX,
        id: "admin",
        status: { label: "Accessible", tone: "accessible" },
        value: `https://game-admin${PLATFORM_SUFFIX}/`,
      },
    ],
    name: "Admin console",
    port: 5201,
  },
];

const ENTRY_NODE_CANVAS_NODES: Node<CanvasEntryNodeData, "entryNode">[] = [
  {
    data: {
      defaultExpanded: false,
      groups: singlePortGroups,
      states: entryNodeStates,
    },
    id: "entry-node-collapsed",
    position: { x: 180, y: 140 },
    type: "entryNode",
  },
  {
    data: {
      defaultExpanded: true,
      groups: singlePortGroups,
      states: entryNodeStates,
    },
    id: "entry-node-expanded",
    position: { x: 560, y: 130 },
    type: "entryNode",
  },
  {
    data: {
      defaultExpanded: true,
      groups: twoPortGroups,
      states: entryNodeStates,
    },
    id: "entry-node-grouped",
    position: { x: 940, y: 130 },
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
