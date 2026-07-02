import type {
  Edge,
  EdgeTypes,
  Node,
  NodeTypes,
  ReactFlowProps,
} from "@xyflow/react";
import type { RefObject } from "react";
import type { CanvasNodeConnectionSide } from "../canvas-node/canvas-node.types";
import type { CanvasEdgeAnchorResolver } from "./canvas.edge-anchors";

export type CanvasInteractionMode = "hand" | "pointer";

/** Props forwarded to `<ReactFlow />`; canvas owns nodes/edges/types/change handlers. */
export type CanvasReactFlowProps = Omit<
  ReactFlowProps<Node, Edge>,
  | "children"
  | "defaultEdges"
  | "defaultNodes"
  | "edgeTypes"
  | "edges"
  | "nodeTypes"
  | "nodes"
  | "onEdgesChange"
  | "onNodesChange"
>;

export interface CanvasState {
  connectionOrigin?: {
    nodeId: string;
    side: CanvasNodeConnectionSide;
  } | null;
  edges: Edge[];
  nodes: Node[];
  selectedEdge: Edge | null;
  selectedNode: Node | null;
}

export type CanvasSelectedNode = CanvasState["selectedNode"];
export type CanvasSelectedEdge = CanvasState["selectedEdge"];

export interface CanvasViewportInsets {
  bottom?: number;
  right?: number;
}

export interface CanvasViewportFocusRequest {
  active?: boolean;
  fitMinZoom?: number;
  /**
   * Apply focus viewport changes without animation. For continuous canvas
   * container resize (e.g. a layout pane drag) where an animated catch-up
   * would lag behind the gesture.
   */
  instant?: boolean;
  key?: number | string;
  maxZoom?: number;
  minZoom?: number;
  nodeIds: readonly string[];
  padding?: number;
}

export interface CanvasMeta {
  /**
   * Session-local canvas interaction mode. Pointer mode supports canvas element
   * selection and resource gestures; hand mode is viewport browsing only.
   */
  defaultInteractionMode?: CanvasInteractionMode;
  /**
   * Optional render-layer edge anchor resolver. When provided, edges with missing endpoint nodes
   * are skipped and resolved pairs are applied as React Flow source/target handles.
   */
  edgeAnchorResolver?: CanvasEdgeAnchorResolver;
  edgeTypes?: EdgeTypes;
  nodeTypes?: NodeTypes;
  /**
   * Controls the one-shot fit-to-view that runs when a canvas opens.
   */
  openingFitView?: {
    key?: number | string;
  };
  reactFlowProps?: CanvasReactFlowProps;
  /**
   * Temporary viewport focus for one or more nodes. This changes viewport only,
   * never node layout.
   */
  viewportFocus?: CanvasViewportFocusRequest;
  /**
   * Optional follow behavior for newly seen nodes selected by the host app.
   * The first node-set observed for each key is treated as opening state.
   */
  viewportFollow?: {
    isFollowTarget: (node: Node) => boolean;
    key?: number | string;
  };
  /**
   * Canvas area covered by sibling chrome such as side panes or drawers.
   * Focus and controls both consume this explicit footprint.
   */
  viewportInsets?: CanvasViewportInsets;
}

export interface CanvasNavigationChromeState {
  beginInteraction: () => void;
  endInteraction: () => void;
  reveal: () => void;
  visible: boolean;
}

export interface CanvasContextValue {
  interactionMode: CanvasInteractionMode;
  meta: CanvasMeta;
  navigationChrome: CanvasNavigationChromeState;
  rootRef: RefObject<HTMLDivElement | null>;
  setInteractionMode: (mode: CanvasInteractionMode) => void;
  state: CanvasState;
}
