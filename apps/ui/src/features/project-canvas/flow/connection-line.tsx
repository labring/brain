"use client";

import {
  type Connection,
  type ConnectionLineComponent,
  type ConnectionLineComponentProps,
  ConnectionLineType,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  type Node,
} from "@xyflow/react";
import { useRef } from "react";

import {
  closestProjectCanvasHandleConnection,
  connectionFromValidProjectCanvasLine,
  PROJECT_CANVAS_CONNECTION_RADIUS,
} from "./interaction";

export interface ProjectCanvasConnectionLineOptions {
  isSupportedConnection: (connection: Connection) => boolean;
  onSnappedConnectionChange: (connection: Connection | null) => void;
  radius?: number;
}

function projectCanvasConnectionLinePath<NodeType extends Node>({
  connectionLineType,
  fromPosition,
  fromX,
  fromY,
  toPosition,
  toX,
  toY,
}: ConnectionLineComponentProps<NodeType>): string {
  const pathParams = {
    sourcePosition: fromPosition,
    sourceX: fromX,
    sourceY: fromY,
    targetPosition: toPosition,
    targetX: toX,
    targetY: toY,
  };

  switch (connectionLineType) {
    case ConnectionLineType.SmoothStep:
      return getSmoothStepPath(pathParams)[0];
    case ConnectionLineType.Step:
      return getSmoothStepPath({ ...pathParams, borderRadius: 0 })[0];
    case ConnectionLineType.Straight:
      return getStraightPath(pathParams)[0];
    default:
      return getBezierPath(pathParams)[0];
  }
}

function handleCenterRelativeToRect(
  element: Element,
  origin: Pick<DOMRectReadOnly, "left" | "top">
): { x: number; y: number } {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2 - origin.left,
    y: rect.top + rect.height / 2 - origin.top,
  };
}

export function createProjectCanvasConnectionLine<
  NodeType extends Node = Node,
>({
  isSupportedConnection,
  onSnappedConnectionChange,
  radius = PROJECT_CANVAS_CONNECTION_RADIUS,
}: ProjectCanvasConnectionLineOptions): ConnectionLineComponent<NodeType> {
  function ProjectCanvasConnectionLine(
    props: ConnectionLineComponentProps<NodeType>
  ) {
    const pathRef = useRef<SVGPathElement | null>(null);
    const snappedReactFlowConnection = connectionFromValidProjectCanvasLine({
      connectionStatus: props.connectionStatus,
      fromHandle: props.fromHandle,
      toHandle: props.toHandle,
    });
    const svgRect = pathRef.current?.ownerSVGElement?.getBoundingClientRect();
    const snappedDomTarget =
      snappedReactFlowConnection === undefined && svgRect !== undefined
        ? closestProjectCanvasHandleConnection({
            doc: pathRef.current?.ownerDocument ?? document,
            fromHandle: props.fromHandle,
            isSupportedConnection,
            point: props.pointer,
            radius,
            resolveHandleCenter: (element) =>
              handleCenterRelativeToRect(element, svgRect),
          })
        : undefined;
    const snappedConnection =
      snappedReactFlowConnection !== undefined &&
      isSupportedConnection(snappedReactFlowConnection)
        ? snappedReactFlowConnection
        : snappedDomTarget?.connection;
    onSnappedConnectionChange(
      snappedConnection === undefined ? null : snappedConnection
    );
    const pathProps =
      snappedDomTarget === undefined
        ? props
        : { ...props, toX: snappedDomTarget.x, toY: snappedDomTarget.y };

    return (
      <path
        className="react-flow__connection-path"
        d={projectCanvasConnectionLinePath(pathProps)}
        fill="none"
        ref={pathRef}
        style={props.connectionLineStyle}
      />
    );
  }

  return ProjectCanvasConnectionLine;
}
