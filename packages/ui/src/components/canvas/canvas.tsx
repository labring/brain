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
} from "@xyflow/react";
import type { ReactNode } from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
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
import { useCanvasViewportDirectives } from "./canvas.viewport-directives";
import {
  canvasViewportFocusNodeIds,
  canvasViewportFocusRequestKey,
  canvasViewportFocusTargetKey,
  focusedViewportFocusState,
  inactiveViewportFocusState,
  initialCanvasViewportFocusState,
  pendingViewportFocusState,
  resolveCanvasViewportFocusRequest,
  shouldApplyFocusedViewport,
  shouldDeferViewportFocusRestore,
  shouldRestoreViewportFocus,
  suspendedViewportFocusState,
  userControlledViewportFocusState,
} from "./canvas.viewport-focus-runtime";
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

const NOOP_UNSUBSCRIBE = () => undefined;

function CanvasFlow({ children }: CanvasFlowProps) {
  const { interactionMode, meta, navigationChrome, rootRef, state } =
    useCanvas();
  const flowStore = meta.flowStore;
  const subscribeFlowStore = useCallback(
    (listener: () => void) =>
      flowStore == null ? NOOP_UNSUBSCRIBE : flowStore.subscribe(listener),
    [flowStore]
  );
  const getFlowSnapshot = useCallback(
    () => flowStore?.getSnapshot(),
    [flowStore]
  );
  const flowSnapshot = useSyncExternalStore(
    subscribeFlowStore,
    getFlowSnapshot,
    getFlowSnapshot
  );
  const directives = useCanvasViewportDirectives(meta.viewportDirectives);
  const [internalNodes, setNodes, onInternalNodesChange] = useNodesState(
    state.nodes
  );
  const [internalEdges, setEdges, onInternalEdgesChange] = useEdgesState(
    state.edges
  );
  const nodes = flowSnapshot?.nodes ?? internalNodes;
  const edges = flowSnapshot?.edges ?? internalEdges;
  const handleNodesChange = useMemo(
    () =>
      flowStore == null
        ? onInternalNodesChange
        : (changes: Parameters<typeof onInternalNodesChange>[0]) =>
            flowStore.applyNodeChanges(changes),
    [flowStore, onInternalNodesChange]
  );
  const handleEdgesChange = useMemo(
    () =>
      flowStore == null
        ? onInternalEdgesChange
        : (changes: Parameters<typeof onInternalEdgesChange>[0]) =>
            flowStore.applyEdgeChanges?.(changes),
    [flowStore, onInternalEdgesChange]
  );
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
    if (flowStore != null || nodeDragging) {
      return;
    }
    if (initializedRef.current) {
      setNodes((prev) => mergeNodes(prev, state.nodes));
    } else {
      initializedRef.current = true;
      setNodes((prev) => (prev === state.nodes ? prev : state.nodes));
    }
  }, [flowStore, nodeDragging, setNodes, state.nodes]);

  useLayoutEffect(() => {
    if (flowStore != null) {
      return;
    }
    setEdges((prev) =>
      edgesMatchIncoming(prev, state.edges) ? prev : state.edges
    );
  }, [flowStore, setEdges, state.edges]);

  const selectedEdgeId =
    flowSnapshot == null
      ? (state.selectedEdge?.id ?? null)
      : (flowSnapshot.selectedEdgeId ?? null);
  const edgesWithSelectionStyle = useMemo((): Edge[] => {
    if (selectedEdgeId == null) {
      return edges;
    }
    return edges.map((edge) => {
      if (edge.id !== selectedEdgeId) {
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
  }, [edges, selectedEdgeId]);
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
  const baseViewportFocus =
    directives == null ? meta.viewportFocus : directives.viewportFocus;
  const directiveInstant = directives?.instant === true;
  const viewportFocus = useMemo(() => {
    if (baseViewportFocus == null) {
      return;
    }
    if (directiveInstant && baseViewportFocus.instant !== true) {
      return { ...baseViewportFocus, instant: true };
    }
    return baseViewportFocus;
  }, [baseViewportFocus, directiveInstant]);
  const viewportInsets =
    directives == null ? meta.viewportInsets : directives.insets;
  const viewportFocusNodeIds = useMemo(
    () => canvasViewportFocusNodeIds(viewportFocus),
    [viewportFocus]
  );
  const viewportFocusTargetKey =
    canvasViewportFocusTargetKey(viewportFocusNodeIds);
  const viewportFocusRequestKey = canvasViewportFocusRequestKey(viewportFocus);
  const viewportFocusActive =
    viewportFocus?.active ?? viewportFocusNodeIds.length > 0;
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
  const openingFitKey =
    (directives == null
      ? meta.openingFitView?.key
      : directives.openingFitKey) ?? DEFAULT_OPENING_FIT_KEY;
  const nodeCount = nodes.length;
  const viewportFollow =
    directives == null ? meta.viewportFollow : directives.viewportFollow;
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
        requestKey: viewportFocusRequestKey,
        state: previous,
        targetKey: viewportFocusTargetKey,
        viewportReady: viewportReadyForViewportActions,
      });
      return;
    }

    if (viewportFocusNodeIds.length === 0) {
      viewportFocusStateRef.current = pendingViewportFocusState({
        getViewport,
        state: previous,
      });
      return;
    }

    const focusResolution = resolveCanvasViewportFocusRequest({
      flowHeight,
      flowWidth,
      focus: viewportFocus,
      nodeIds: viewportFocusNodeIds,
      nodes,
      targetKey: viewportFocusTargetKey,
      viewport: getViewport(),
      viewportInsets,
    });
    if (focusResolution === null) {
      return;
    }

    viewportFocusStateRef.current = focusedViewportFocusState({
      focusKey: focusResolution.focusKey,
      getViewport,
      requestKey: focusResolution.requestKey,
      state: previous,
      targetKey: focusResolution.targetKey,
    });

    if (
      focusResolution.action.kind === "setViewport" &&
      shouldApplyFocusedViewport({
        focusKey: focusResolution.focusKey,
        requestKey: focusResolution.requestKey,
        state: previous,
        targetKey: focusResolution.targetKey,
      })
    ) {
      setViewport(
        focusResolution.action.viewport,
        viewportFocus?.instant === true
          ? undefined
          : { duration: VIEWPORT_FOCUS_ANIMATION_MS, interpolate: "smooth" }
      );
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
    viewportInsets,
    viewportFocusNodeIds,
    viewportFocusRequestKey,
    viewportFocusTargetKey,
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
            onEdgesChange={handleEdgesChange}
            onNodesChange={handleNodesChange}
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
