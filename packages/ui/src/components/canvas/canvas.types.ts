import type {
  Edge,
  EdgeChange,
  EdgeTypes,
  Node,
  NodeChange,
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

export interface CanvasFlowSnapshot {
  edges: Edge[];
  nodes: Node[];
}

/**
 * Host-owned controlled store for flow nodes/edges. When provided via
 * `CanvasMeta.flowStore`, the canvas renders from the store snapshot and
 * routes React Flow changes back into it instead of mirroring nodes in
 * component state.
 */
export interface CanvasFlowStore {
  applyEdgeChanges?(changes: EdgeChange[]): void;
  applyNodeChanges(changes: NodeChange[]): void;
  getSnapshot(): CanvasFlowSnapshot;
  subscribe(listener: () => void): () => void;
}

export interface CanvasViewportFollowRequest {
  isFollowTarget: (node: Node) => boolean;
  key?: number | string;
}

/**
 * One snapshot of host-issued viewport directives. Directives describe
 * viewport behavior only (opening fit, focus, follow, insets) and never
 * node layout.
 */
export interface CanvasViewportDirectives {
  insets?: CanvasViewportInsets;
  /** Apply focus viewport changes without animation while set. */
  instant?: boolean;
  openingFitKey?: number | string;
  viewportFocus?: CanvasViewportFocusRequest;
  viewportFollow?: CanvasViewportFollowRequest;
}

/**
 * Host-owned imperative channel for viewport directives. When provided via
 * `CanvasMeta.viewportDirectives`, the canvas consumes directives from this
 * store and the corresponding static `CanvasMeta` fields are ignored, so
 * meta can stay referentially constant.
 */
export interface CanvasViewportDirectiveStore {
  getDirectives(): CanvasViewportDirectives;
  subscribe(listener: () => void): () => void;
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
  /**
   * Controlled nodes/edges source. When set, the canvas is a controlled view
   * of this store; when omitted, nodes/edges are mirrored into internal state
   * (static/preview usage).
   */
  flowStore?: CanvasFlowStore;
  nodeTypes?: NodeTypes;
  /**
   * Controls the one-shot fit-to-view that runs when a canvas opens.
   */
  openingFitView?: {
    key?: number | string;
  };
  reactFlowProps?: CanvasReactFlowProps;
  /**
   * Imperative viewport directive channel. Takes precedence over the static
   * viewportFocus/viewportFollow/viewportInsets/openingFitView meta fields.
   */
  viewportDirectives?: CanvasViewportDirectiveStore;
  /**
   * Temporary viewport focus for one or more nodes. This changes viewport only,
   * never node layout.
   */
  viewportFocus?: CanvasViewportFocusRequest;
  /**
   * Optional follow behavior for newly seen nodes selected by the host app.
   * The first node-set observed for each key is treated as opening state.
   */
  viewportFollow?: CanvasViewportFollowRequest;
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
