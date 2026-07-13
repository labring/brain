"use client";

import {
  Panel,
  type ReactFlowState,
  useStore,
  useStoreApi,
} from "@xyflow/react";
import {
  getBoundsOfRects,
  getInternalNodesBounds,
  getNodeDimensions,
  nodeHasDimensions,
  XYMinimap,
  type XYMinimapInstance,
} from "@xyflow/system";
import type { CSSProperties } from "react";
import { memo, useEffect, useMemo, useRef } from "react";

const MINIMAP_ARIA_LABEL = "Canvas mini map";
const MINIMAP_HEIGHT = 130;
const MINIMAP_OFFSET_SCALE = 5;
const MINIMAP_WIDTH = 223;

interface CanvasMiniMapViewportProjection {
  boundsHeight: number;
  boundsWidth: number;
  boundsX: number;
  boundsY: number;
  flowHeight: number;
  flowWidth: number;
  panZoom: ReactFlowState["panZoom"];
  rfId: string;
  translateMaxX: number;
  translateMaxY: number;
  translateMinX: number;
  translateMinY: number;
  viewHeight: number;
  viewWidth: number;
  viewX: number;
  viewY: number;
}

interface CanvasMiniMapNodeProjection {
  height: number;
  hidden: boolean;
  width: number;
  x: number;
  y: number;
}

type CanvasMiniMapStyle = CSSProperties & {
  [property: `--${string}`]: number | string;
};

function selectCanvasMiniMapViewport(
  state: ReactFlowState
): CanvasMiniMapViewportProjection {
  const [translateX, translateY, zoom] = state.transform;
  const viewX = -translateX / zoom;
  const viewY = -translateY / zoom;
  const viewWidth = state.width / zoom;
  const viewHeight = state.height / zoom;
  const viewBounds = {
    height: viewHeight,
    width: viewWidth,
    x: viewX,
    y: viewY,
  };
  const bounds =
    state.nodeLookup.size === 0
      ? viewBounds
      : getBoundsOfRects(
          getInternalNodesBounds(state.nodeLookup, {
            filter: (node) => !node.hidden,
          }),
          viewBounds
        );

  return {
    boundsHeight: bounds.height,
    boundsWidth: bounds.width,
    boundsX: bounds.x,
    boundsY: bounds.y,
    flowHeight: state.height,
    flowWidth: state.width,
    panZoom: state.panZoom,
    rfId: state.rfId,
    translateMaxX: state.translateExtent[1][0],
    translateMaxY: state.translateExtent[1][1],
    translateMinX: state.translateExtent[0][0],
    translateMinY: state.translateExtent[0][1],
    viewHeight,
    viewWidth,
    viewX,
    viewY,
  };
}

function canvasMiniMapViewportEqual(
  previous: CanvasMiniMapViewportProjection,
  next: CanvasMiniMapViewportProjection
): boolean {
  return (
    Object.is(previous.boundsHeight, next.boundsHeight) &&
    Object.is(previous.boundsWidth, next.boundsWidth) &&
    Object.is(previous.boundsX, next.boundsX) &&
    Object.is(previous.boundsY, next.boundsY) &&
    Object.is(previous.flowHeight, next.flowHeight) &&
    Object.is(previous.flowWidth, next.flowWidth) &&
    previous.panZoom === next.panZoom &&
    previous.rfId === next.rfId &&
    Object.is(previous.translateMaxX, next.translateMaxX) &&
    Object.is(previous.translateMaxY, next.translateMaxY) &&
    Object.is(previous.translateMinX, next.translateMinX) &&
    Object.is(previous.translateMinY, next.translateMinY) &&
    Object.is(previous.viewHeight, next.viewHeight) &&
    Object.is(previous.viewWidth, next.viewWidth) &&
    Object.is(previous.viewX, next.viewX) &&
    Object.is(previous.viewY, next.viewY)
  );
}

function selectCanvasMiniMapNodeIds(state: ReactFlowState): string[] {
  return state.nodes.map((node) => node.id);
}

function canvasMiniMapNodeIdsEqual(
  previous: string[],
  next: string[]
): boolean {
  return (
    previous.length === next.length &&
    previous.every((nodeId, index) => nodeId === next[index])
  );
}

function canvasMiniMapNodeEqual(
  previous: CanvasMiniMapNodeProjection | null,
  next: CanvasMiniMapNodeProjection | null
): boolean {
  if (previous === null || next === null) {
    return previous === next;
  }
  return (
    Object.is(previous.height, next.height) &&
    previous.hidden === next.hidden &&
    Object.is(previous.width, next.width) &&
    Object.is(previous.x, next.x) &&
    Object.is(previous.y, next.y)
  );
}

function CanvasMiniMapNode({ id }: { id: string }) {
  const selector = useMemo(
    () =>
      (state: ReactFlowState): CanvasMiniMapNodeProjection | null => {
        const node = state.nodeLookup.get(id);
        if (node === undefined) {
          return null;
        }
        const userNode = node.internals.userNode;
        const { height, width } = getNodeDimensions(userNode);
        return {
          height,
          hidden: userNode.hidden === true || !nodeHasDimensions(userNode),
          width,
          x: node.internals.positionAbsolute.x,
          y: node.internals.positionAbsolute.y,
        };
      },
    [id]
  );
  const node = useStore(selector, canvasMiniMapNodeEqual);

  if (node === null || node.hidden) {
    return null;
  }

  return (
    <rect
      className="react-flow__minimap-node"
      height={node.height}
      rx="var(--canvas-minimap-node-radius)"
      ry="var(--canvas-minimap-node-radius)"
      shapeRendering={
        typeof window === "undefined" || "chrome" in window
          ? "crispEdges"
          : "geometricPrecision"
      }
      style={{
        fill: "color-mix(in oklab, var(--color-zinc-950) 80%, transparent)",
        stroke: "transparent",
        strokeWidth: 0,
      }}
      width={node.width}
      x={node.x}
      y={node.y}
    />
  );
}

const MemoCanvasMiniMapNode = memo(CanvasMiniMapNode);

function CanvasMiniMapNodes() {
  const nodeIds = useStore(
    selectCanvasMiniMapNodeIds,
    canvasMiniMapNodeIdsEqual
  );

  return nodeIds.map((nodeId) => (
    <MemoCanvasMiniMapNode id={nodeId} key={nodeId} />
  ));
}

function CanvasMiniMapViewportComponent() {
  const store = useStoreApi();
  const projection = useStore(
    selectCanvasMiniMapViewport,
    canvasMiniMapViewportEqual
  );
  const svgRef = useRef<SVGSVGElement>(null);
  const minimapInstanceRef = useRef<XYMinimapInstance>(null);
  const viewScaleRef = useRef(0);
  const viewScale = Math.max(
    projection.boundsWidth / MINIMAP_WIDTH,
    projection.boundsHeight / MINIMAP_HEIGHT
  );
  const viewWidth = viewScale * MINIMAP_WIDTH;
  const viewHeight = viewScale * MINIMAP_HEIGHT;
  const offset = MINIMAP_OFFSET_SCALE * viewScale;
  const x =
    projection.boundsX - (viewWidth - projection.boundsWidth) / 2 - offset;
  const y =
    projection.boundsY - (viewHeight - projection.boundsHeight) / 2 - offset;
  const width = viewWidth + offset * 2;
  const height = viewHeight + offset * 2;
  const labelledBy = `react-flow__minimap-desc-${projection.rfId}`;
  const minimapStyle: CanvasMiniMapStyle = {
    "--xy-minimap-background-color-props":
      "color-mix(in oklab, var(--input) 30%, transparent)",
    "--xy-minimap-mask-background-color-props":
      "color-mix(in oklab, var(--input) 30%, transparent)",
    "--xy-minimap-mask-stroke-color-props": "var(--color-border)",
    "--xy-minimap-mask-stroke-width-props": viewScale,
    height: MINIMAP_HEIGHT,
    margin: 0,
    width: MINIMAP_WIDTH,
  };

  useEffect(() => {
    viewScaleRef.current = viewScale;
  }, [viewScale]);

  useEffect(() => {
    const svg = svgRef.current;
    if (svg === null || projection.panZoom === null) {
      return;
    }
    const instance = XYMinimap({
      domNode: svg,
      getTransform: () => store.getState().transform,
      getViewScale: () => viewScaleRef.current,
      panZoom: projection.panZoom,
    });
    minimapInstanceRef.current = instance;
    return () => {
      instance.destroy();
      minimapInstanceRef.current = null;
    };
  }, [projection.panZoom, store]);

  useEffect(() => {
    if (projection.panZoom === null) {
      return;
    }
    minimapInstanceRef.current?.update({
      height: projection.flowHeight,
      pannable: true,
      translateExtent: [
        [projection.translateMinX, projection.translateMinY],
        [projection.translateMaxX, projection.translateMaxY],
      ],
      width: projection.flowWidth,
      zoomable: true,
      zoomStep: 1,
    });
  }, [
    projection.flowHeight,
    projection.flowWidth,
    projection.panZoom,
    projection.translateMaxX,
    projection.translateMaxY,
    projection.translateMinX,
    projection.translateMinY,
  ]);

  return (
    <Panel
      className="react-flow__minimap overflow-hidden bg-input/30 shadow-none"
      data-testid="rf__minimap"
      position="top-left"
      style={minimapStyle}
    >
      <svg
        aria-labelledby={labelledBy}
        className="react-flow__minimap-svg"
        height={MINIMAP_HEIGHT}
        ref={svgRef}
        role="img"
        viewBox={`${x} ${y} ${width} ${height}`}
        width={MINIMAP_WIDTH}
      >
        <title id={labelledBy}>{MINIMAP_ARIA_LABEL}</title>
        <CanvasMiniMapNodes />
        <path
          className="react-flow__minimap-mask"
          d={`M${x - offset},${y - offset}h${width + offset * 2}v${height + offset * 2}h${-width - offset * 2}z
        M${projection.viewX},${projection.viewY}h${projection.viewWidth}v${projection.viewHeight}h${-projection.viewWidth}z`}
          fillRule="evenodd"
          pointerEvents="none"
        />
      </svg>
    </Panel>
  );
}

/**
 * React Flow's stock MiniMap selector recreates its projection for every store
 * notification. Keep this boundary memoized as well so Canvas context updates
 * (for example, selection-only changes) cannot enter the SVG subtree.
 */
export const CanvasMiniMapViewport = memo(CanvasMiniMapViewportComponent);
