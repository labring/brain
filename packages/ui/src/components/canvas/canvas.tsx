"use client";

import "@xyflow/react/dist/base.css";
import "@xyflow/react/dist/style.css";
import "./canvas.css";

import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  type Edge,
  type Node,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  useStore,
  type Viewport,
} from "@xyflow/react";
import type { ReactNode } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { CanvasControls, CanvasMiniMap } from "./canvas.controls";
import {
  type CanvasEdgeAnchorPair,
  resolveCanvasEdgeAnchors,
} from "./canvas.edge-anchors";
import { mergeNodes } from "./canvas.node-merge";
import { CanvasProvider } from "./canvas.provider";
import type { CanvasReactFlowProps } from "./canvas.types";
import {
  CanvasUpperRight,
  CanvasUpperRightAnchor,
  CanvasUpperRightProvider,
} from "./canvas.upper-right";
import { useCanvas } from "./canvas.use";
import {
  nodeBoundsForViewportFocus,
  resolveCanvasViewportFocus,
} from "./canvas.viewport-focus";
import {
  initialCanvasViewportFollowState,
  resolveCanvasViewportFollow,
} from "./canvas.viewport-follow";

export interface CanvasFlowProps {
  children?: ReactNode;
}

export interface CanvasRootProps {
  children?: ReactNode;
  meta?: Parameters<typeof CanvasProvider>[0]["meta"];
  state: Parameters<typeof CanvasProvider>[0]["state"];
}

const CANVAS_DEFAULT_EDGE_STYLE = {
  stroke: "var(--color-blue-400)",
  strokeDasharray: "6 6",
};
const DEFAULT_OPENING_FIT_KEY = "__default__";
const OPENING_FIT_ANIMATION_MS = 300;
const OPENING_FIT_SETTLE_MS = 150;
const VIEWPORT_FOLLOW_ANIMATION_MS = 300;
const VIEWPORT_FOCUS_ANIMATION_MS = 200;
const VIEWPORT_FOCUS_DEFAULT_MIN_ZOOM = 0.85;
const VIEWPORT_FOCUS_DEFAULT_MAX_ZOOM = 1.05;

interface CanvasViewportFocusRuntimeState {
  active: boolean;
  baseline: Viewport | null;
  initialized: boolean;
  lastFocusKey: string | null;
  targetNodeId: string | null;
  userControlled: boolean;
}

const initialCanvasViewportFocusState: CanvasViewportFocusRuntimeState = {
  active: false,
  baseline: null,
  initialized: false,
  lastFocusKey: null,
  targetNodeId: null,
  userControlled: false,
};

function shouldRestoreViewportFocus(
  state: CanvasViewportFocusRuntimeState
): state is CanvasViewportFocusRuntimeState & { baseline: Viewport } {
  return state.active && state.baseline !== null && !state.userControlled;
}

function shouldDeferViewportFocusRestore({
  state,
  viewportReady,
}: {
  state: CanvasViewportFocusRuntimeState;
  viewportReady: boolean;
}) {
  return shouldRestoreViewportFocus(state) && !viewportReady;
}

function inactiveViewportFocusState({
  ready,
  state,
}: {
  ready: boolean;
  state: CanvasViewportFocusRuntimeState;
}): CanvasViewportFocusRuntimeState {
  if (state.active) {
    return {
      ...initialCanvasViewportFocusState,
      initialized: true,
    };
  }

  return {
    ...state,
    initialized: state.initialized || ready,
  };
}

function suspendedViewportFocusState({
  getViewport,
  nodeId,
  state,
  viewportReady,
}: {
  getViewport: () => Viewport;
  nodeId: string | null;
  state: CanvasViewportFocusRuntimeState;
  viewportReady: boolean;
}): CanvasViewportFocusRuntimeState {
  const openingSession = !state.active;

  return {
    active: true,
    baseline:
      openingSession && state.initialized && viewportReady
        ? getViewport()
        : state.baseline,
    initialized: true,
    lastFocusKey: state.lastFocusKey,
    targetNodeId: nodeId,
    userControlled: state.userControlled,
  };
}

function pendingViewportFocusState({
  getViewport,
  state,
}: {
  getViewport: () => Viewport;
  state: CanvasViewportFocusRuntimeState;
}): CanvasViewportFocusRuntimeState {
  const openingSession = !state.active;

  return {
    active: true,
    baseline:
      openingSession && state.initialized ? getViewport() : state.baseline,
    initialized: true,
    lastFocusKey: null,
    targetNodeId: null,
    userControlled: state.userControlled,
  };
}

function focusedViewportFocusState({
  focusKey,
  nodeId,
  state,
  getViewport,
}: {
  focusKey: string;
  getViewport: () => Viewport;
  nodeId: string;
  state: CanvasViewportFocusRuntimeState;
}): CanvasViewportFocusRuntimeState {
  const openingSession = !state.active;

  return {
    active: true,
    baseline:
      openingSession && state.initialized ? getViewport() : state.baseline,
    initialized: true,
    lastFocusKey: focusKey,
    targetNodeId: nodeId,
    userControlled: state.userControlled,
  };
}

function shouldApplyFocusedViewport({
  focusKey,
  nodeId,
  state,
}: {
  focusKey: string;
  nodeId: string;
  state: CanvasViewportFocusRuntimeState;
}): boolean {
  if (state.lastFocusKey === focusKey) {
    return false;
  }

  const targetChanged = state.targetNodeId !== nodeId;
  return !(state.active && state.userControlled && !targetChanged);
}

function userControlledViewportFocusState(
  state: CanvasViewportFocusRuntimeState
): CanvasViewportFocusRuntimeState {
  if (!(state.active && !state.userControlled)) {
    return state;
  }

  return {
    ...state,
    userControlled: true,
  };
}

function resolveCanvasReactFlowProps({
  handMode,
  onMove,
  onMoveEnd,
  onMoveStart,
  userReactFlowProps,
}: {
  handMode: boolean;
  onMove: NonNullable<CanvasReactFlowProps["onMove"]>;
  onMoveEnd: NonNullable<CanvasReactFlowProps["onMoveEnd"]>;
  onMoveStart: NonNullable<CanvasReactFlowProps["onMoveStart"]>;
  userReactFlowProps: CanvasReactFlowProps;
}): CanvasReactFlowProps {
  const userConnectionLineStyle = userReactFlowProps.connectionLineStyle;
  const userDefaultEdgeOptions = userReactFlowProps.defaultEdgeOptions;
  const interactionOverrides: CanvasReactFlowProps = handMode
    ? {
        autoPanOnNodeFocus: false,
        deleteKeyCode: null,
        edgesFocusable: false,
        elementsSelectable: false,
        isValidConnection: () => false,
        multiSelectionKeyCode: null,
        nodesConnectable: false,
        nodesDraggable: false,
        nodesFocusable: false,
        onConnect: undefined,
        onConnectEnd: undefined,
        onConnectStart: undefined,
        onEdgeClick: undefined,
        onNodeClick: undefined,
        onNodeContextMenu: undefined,
        onNodeDoubleClick: undefined,
        onNodeDragStart: undefined,
        onNodeDragStop: undefined,
        onPaneClick: undefined,
        selectionKeyCode: null,
      }
    : {};

  return {
    connectionMode: ConnectionMode.Loose,
    maxZoom: 1.2,
    minZoom: 0.3,
    panOnDrag: true,
    panOnScroll: true,
    proOptions: { hideAttribution: true },
    selectNodesOnDrag: false,
    snapGrid: [8, 8],
    snapToGrid: true,
    ...userReactFlowProps,
    ...interactionOverrides,
    fitView: false,
    onMove,
    onMoveEnd,
    onMoveStart,
    connectionLineStyle: {
      ...CANVAS_DEFAULT_EDGE_STYLE,
      ...(userConnectionLineStyle ?? {}),
    },
    defaultEdgeOptions: {
      ...userDefaultEdgeOptions,
      style: {
        ...CANVAS_DEFAULT_EDGE_STYLE,
        ...(userDefaultEdgeOptions?.style ?? {}),
      },
    },
  };
}

function edgesMatchIncoming(current: Edge[], incoming: Edge[]): boolean {
  if (current.length !== incoming.length) {
    return false;
  }

  return incoming.every((edge, index) => {
    const existing = current[index];
    if (existing === undefined) {
      return false;
    }

    return (Object.keys(edge) as Array<keyof Edge>).every((key) =>
      Object.is(existing[key], edge[key])
    );
  });
}

function CanvasFlow({ children }: CanvasFlowProps) {
  const { interactionMode, meta, navigationChrome, rootRef, state } =
    useCanvas();
  const [nodes, setNodes, onNodesChange] = useNodesState(state.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(state.edges);
  const {
    fitView,
    getViewport,
    getZoom,
    setCenter,
    setViewport,
    viewportInitialized,
  } = useReactFlow<Node, Edge>();
  const nodesInitialized = useNodesInitialized();
  const flowHeight = useStore((store) => store.height);
  const flowWidth = useStore((store) => store.width);
  const initializedRef = useRef(false);
  const openingFitAppliedKeyRef = useRef<number | string | null>(null);
  const viewportFollowStateRef = useRef(initialCanvasViewportFollowState);
  const viewportFocusStateRef = useRef(initialCanvasViewportFocusState);
  const edgeAnchorPairsRef = useRef(new Map<string, CanvasEdgeAnchorPair>());
  const nodeDragNavigationHoldActiveRef = useRef(false);
  const viewportNavigationHoldActiveRef = useRef(false);

  const nodeDragging = nodes.some((node) => node.dragging === true);

  useLayoutEffect(() => {
    if (nodeDragging) {
      return;
    }
    if (initializedRef.current) {
      setNodes((prev) => mergeNodes(prev, state.nodes));
    } else {
      initializedRef.current = true;
      setNodes((prev) => (prev === state.nodes ? prev : state.nodes));
    }
  }, [nodeDragging, setNodes, state.nodes]);

  useLayoutEffect(() => {
    setEdges((prev) =>
      edgesMatchIncoming(prev, state.edges) ? prev : state.edges
    );
  }, [setEdges, state.edges]);

  const edgesWithSelectionStyle = useMemo((): Edge[] => {
    const selected = state.selectedEdge;
    if (selected == null) {
      return edges;
    }
    return edges.map((edge) => {
      if (edge.id !== selected.id) {
        return edge;
      }
      const prev =
        edge.style && typeof edge.style === "object" ? edge.style : {};
      return {
        ...edge,
        style: {
          ...CANVAS_DEFAULT_EDGE_STYLE,
          ...prev,
          stroke: CANVAS_DEFAULT_EDGE_STYLE.stroke,
        },
      };
    });
  }, [edges, state.selectedEdge]);
  const edgeAnchorResolver = meta.edgeAnchorResolver;
  const edgeAnchorResolution = useMemo(() => {
    if (edgeAnchorResolver == null) {
      return {
        anchorPairs: edgeAnchorPairsRef.current,
        edges: edgesWithSelectionStyle,
      };
    }

    return resolveCanvasEdgeAnchors({
      dragging: nodeDragging,
      edges: edgesWithSelectionStyle,
      nodes,
      previousPairs: edgeAnchorPairsRef.current,
      resolver: edgeAnchorResolver,
    });
  }, [edgeAnchorResolver, edgesWithSelectionStyle, nodeDragging, nodes]);

  useEffect(() => {
    if (edgeAnchorResolver == null) {
      edgeAnchorPairsRef.current.clear();
      return;
    }

    edgeAnchorPairsRef.current = edgeAnchorResolution.anchorPairs;
  }, [edgeAnchorResolver, edgeAnchorResolution.anchorPairs]);

  const userReactFlowProps = meta.reactFlowProps ?? {};
  const openingFitViewOptions = userReactFlowProps.fitViewOptions;
  const shouldFitOpeningView = userReactFlowProps.fitView !== false;
  const viewportFocus = meta.viewportFocus;
  const viewportFocusNodeId = viewportFocus?.nodeId ?? null;
  const viewportFocusActive =
    viewportFocus?.active ?? viewportFocusNodeId !== null;
  const handleMoveStart: NonNullable<CanvasReactFlowProps["onMoveStart"]> = (
    event,
    viewport
  ) => {
    if (event?.type === "wheel") {
      viewportFocusStateRef.current = userControlledViewportFocusState(
        viewportFocusStateRef.current
      );
      navigationChrome.reveal();
    } else if (event != null && !viewportNavigationHoldActiveRef.current) {
      viewportNavigationHoldActiveRef.current = true;
      navigationChrome.beginInteraction();
    }
    userReactFlowProps.onMoveStart?.(event, viewport);
  };
  const handleMove: NonNullable<CanvasReactFlowProps["onMove"]> = (
    event,
    viewport
  ) => {
    if (event != null) {
      viewportFocusStateRef.current = userControlledViewportFocusState(
        viewportFocusStateRef.current
      );
      if (event.type === "wheel") {
        navigationChrome.reveal();
      }
    }
    userReactFlowProps.onMove?.(event, viewport);
  };
  const handleMoveEnd: NonNullable<CanvasReactFlowProps["onMoveEnd"]> = (
    event,
    viewport
  ) => {
    if (viewportNavigationHoldActiveRef.current) {
      viewportNavigationHoldActiveRef.current = false;
      navigationChrome.endInteraction();
    }
    userReactFlowProps.onMoveEnd?.(event, viewport);
  };
  const handleNodeDragStart: CanvasReactFlowProps["onNodeDragStart"] = (
    ...args
  ) => {
    if (!nodeDragNavigationHoldActiveRef.current) {
      nodeDragNavigationHoldActiveRef.current = true;
      navigationChrome.beginInteraction();
    }
    userReactFlowProps.onNodeDragStart?.(...args);
  };
  const handleNodeDragStop: CanvasReactFlowProps["onNodeDragStop"] = (
    ...args
  ) => {
    try {
      userReactFlowProps.onNodeDragStop?.(...args);
    } finally {
      if (nodeDragNavigationHoldActiveRef.current) {
        nodeDragNavigationHoldActiveRef.current = false;
        navigationChrome.endInteraction();
      }
    }
  };
  const handMode = interactionMode === "hand";
  const passThrough = resolveCanvasReactFlowProps({
    handMode,
    onMove: handleMove,
    onMoveEnd: handleMoveEnd,
    onMoveStart: handleMoveStart,
    userReactFlowProps: {
      ...userReactFlowProps,
      onNodeDragStart: handleNodeDragStart,
      onNodeDragStop: handleNodeDragStop,
    },
  });
  const openingFitKey = meta.openingFitView?.key ?? DEFAULT_OPENING_FIT_KEY;
  const nodeCount = nodes.length;
  const viewportFollow = meta.viewportFollow;
  const viewportFollowTarget = viewportFollow?.isFollowTarget;
  const viewportFollowKey = viewportFollow?.key ?? openingFitKey;
  const viewportReadyForViewportActions =
    viewportInitialized && flowHeight > 0 && flowWidth > 0;
  const canvasReadyForViewportActions =
    viewportReadyForViewportActions && nodesInitialized;

  useEffect(() => {
    if (
      openingFitAppliedKeyRef.current === openingFitKey ||
      !shouldFitOpeningView ||
      !viewportInitialized ||
      !nodesInitialized ||
      flowHeight <= 0 ||
      flowWidth <= 0 ||
      nodeCount === 0
    ) {
      return;
    }

    if (viewportFocusActive) {
      openingFitAppliedKeyRef.current = openingFitKey;
      return;
    }

    let firstFrame = 0;
    let secondFrame = 0;
    const settleTimer = window.setTimeout(() => {
      firstFrame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(() => {
          openingFitAppliedKeyRef.current = openingFitKey;
          fitView({
            duration: OPENING_FIT_ANIMATION_MS,
            ...openingFitViewOptions,
          });
        });
      });
    }, OPENING_FIT_SETTLE_MS);

    return () => {
      window.clearTimeout(settleTimer);
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [
    fitView,
    flowHeight,
    flowWidth,
    nodeCount,
    nodesInitialized,
    openingFitKey,
    openingFitViewOptions,
    shouldFitOpeningView,
    viewportInitialized,
    viewportFocusActive,
  ]);

  useEffect(() => {
    const previous = viewportFocusStateRef.current;
    if (!viewportFocusActive) {
      if (
        shouldDeferViewportFocusRestore({
          state: previous,
          viewportReady: viewportReadyForViewportActions,
        })
      ) {
        return;
      }
      viewportFocusStateRef.current = inactiveViewportFocusState({
        ready: viewportReadyForViewportActions,
        state: previous,
      });
      if (shouldRestoreViewportFocus(previous)) {
        setViewport(previous.baseline, {
          duration: VIEWPORT_FOCUS_ANIMATION_MS,
        });
      }
      return;
    }

    if (!canvasReadyForViewportActions) {
      viewportFocusStateRef.current = suspendedViewportFocusState({
        getViewport,
        nodeId: viewportFocusNodeId,
        state: previous,
        viewportReady: viewportReadyForViewportActions,
      });
      return;
    }

    if (viewportFocusNodeId === null) {
      viewportFocusStateRef.current = pendingViewportFocusState({
        getViewport,
        state: previous,
      });
      return;
    }

    const node = nodes.find(
      (candidate) => candidate.id === viewportFocusNodeId
    );
    if (node === undefined || viewportFocus === undefined) {
      return;
    }

    const rightInset = Math.max(0, viewportFocus.rightInset);
    const minZoom = viewportFocus.minZoom ?? VIEWPORT_FOCUS_DEFAULT_MIN_ZOOM;
    const maxZoom = viewportFocus.maxZoom ?? VIEWPORT_FOCUS_DEFAULT_MAX_ZOOM;
    const focusKey = [
      viewportFocusNodeId,
      flowWidth,
      flowHeight,
      rightInset,
      minZoom,
      maxZoom,
    ].join(":");
    const action = resolveCanvasViewportFocus({
      flowHeight,
      flowWidth,
      maxZoom,
      minZoom,
      node: nodeBoundsForViewportFocus(node),
      rightInset,
      viewport: getViewport(),
    });
    viewportFocusStateRef.current = focusedViewportFocusState({
      focusKey,
      getViewport,
      nodeId: viewportFocusNodeId,
      state: previous,
    });

    if (
      action.kind === "setViewport" &&
      shouldApplyFocusedViewport({
        focusKey,
        nodeId: viewportFocusNodeId,
        state: previous,
      })
    ) {
      setViewport(action.viewport, {
        duration: VIEWPORT_FOCUS_ANIMATION_MS,
        interpolate: "smooth",
      });
    }
  }, [
    canvasReadyForViewportActions,
    flowHeight,
    flowWidth,
    getViewport,
    nodes,
    setViewport,
    viewportFocus,
    viewportFocusActive,
    viewportFocusNodeId,
    viewportReadyForViewportActions,
  ]);

  useEffect(() => {
    if (viewportFollowTarget === undefined) {
      viewportFollowStateRef.current = initialCanvasViewportFollowState;
      return;
    }

    if (!canvasReadyForViewportActions) {
      return;
    }

    const result = resolveCanvasViewportFollow({
      isFollowTarget: viewportFollowTarget,
      key: viewportFollowKey,
      nodes,
      state: viewportFollowStateRef.current,
    });
    viewportFollowStateRef.current = result.state;

    switch (result.action.kind) {
      case "fitView":
        fitView({
          duration: VIEWPORT_FOLLOW_ANIMATION_MS,
          nodes: result.action.nodeIds.map((id) => ({ id })),
        });
        return;
      case "none":
        return;
      case "setCenter": {
        const { nodeId } = result.action;
        const node = nodes.find((candidate) => candidate.id === nodeId);
        if (node === undefined) {
          return;
        }
        const width = node.measured?.width ?? node.width ?? 0;
        const height = node.measured?.height ?? node.height ?? 0;
        setCenter(node.position.x + width / 2, node.position.y + height / 2, {
          duration: VIEWPORT_FOLLOW_ANIMATION_MS,
          zoom: getZoom(),
        });
        return;
      }
      default:
        return;
    }
  }, [
    canvasReadyForViewportActions,
    fitView,
    getZoom,
    nodes,
    setCenter,
    viewportFollowKey,
    viewportFollowTarget,
  ]);

  return (
    <CanvasUpperRightProvider>
      <div
        className="relative h-full min-h-0 w-full min-w-0"
        data-slot="canvas-flow-root"
        ref={rootRef}
      >
        <CanvasUpperRightAnchor />
        <div className="canvas-surface">
          <ReactFlow
            {...passThrough}
            className={
              handMode
                ? [userReactFlowProps.className, "canvas-interaction-hand"]
                    .filter(Boolean)
                    .join(" ")
                : userReactFlowProps.className
            }
            edges={edgeAnchorResolution.edges}
            edgeTypes={meta.edgeTypes}
            nodes={nodes}
            nodeTypes={meta.nodeTypes}
            onEdgesChange={onEdgesChange}
            onNodesChange={onNodesChange}
          >
            <Background
              color="var(--color-canvas-dot)"
              gap={32}
              size={1}
              variant={BackgroundVariant.Dots}
            />
          </ReactFlow>
        </div>
        {children}
      </div>
    </CanvasUpperRightProvider>
  );
}

function CanvasRoot({ children, meta, state }: CanvasRootProps) {
  return (
    <CanvasProvider meta={meta} state={state}>
      {children}
    </CanvasProvider>
  );
}

function CanvasSurface({ children }: CanvasFlowProps) {
  return (
    <div className="h-full min-h-0 w-full min-w-0">
      <ReactFlowProvider>
        <CanvasFlow>{children}</CanvasFlow>
      </ReactFlowProvider>
    </div>
  );
}

export const Canvas = Object.assign(CanvasSurface, {
  Controls: CanvasControls,
  Flow: CanvasSurface,
  MiniMap: CanvasMiniMap,
  Root: CanvasRoot,
  UpperRight: CanvasUpperRight,
});

export type CanvasProps = CanvasRootProps;
