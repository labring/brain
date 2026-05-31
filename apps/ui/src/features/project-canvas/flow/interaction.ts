import type { CanvasReactFlowProps } from "@workspace/ui/components/canvas/canvas.types";
import type { Connection, HandleType } from "@xyflow/react";

export interface ProjectCanvasInteractionOptions {
  isValidConnection?: NonNullable<CanvasReactFlowProps["isValidConnection"]>;
  onConnect?: NonNullable<CanvasReactFlowProps["onConnect"]>;
  onConnectEnd?: NonNullable<CanvasReactFlowProps["onConnectEnd"]>;
  onConnectStart?: NonNullable<CanvasReactFlowProps["onConnectStart"]>;
  readOnly: boolean;
}

type ProjectCanvasInteractionProps = Pick<
  CanvasReactFlowProps,
  | "connectOnClick"
  | "connectionRadius"
  | "edgesReconnectable"
  | "isValidConnection"
  | "nodesConnectable"
  | "nodesDraggable"
  | "onConnect"
  | "onConnectEnd"
  | "onConnectStart"
>;

export const PROJECT_CANVAS_CONNECTION_RADIUS = 20;
const PROJECT_CANVAS_HANDLE_SELECTOR =
  '.react-flow__handle[data-slot="canvas-node-rf-handle"]';

export interface ProjectCanvasConnectionHandle {
  id?: string | null;
  nodeId?: string | null;
  type?: HandleType | null;
}

export interface ProjectCanvasSnappedConnectionState {
  fromHandle?: ProjectCanvasConnectionHandle | null;
  isValid?: boolean | null;
  toHandle?: ProjectCanvasConnectionHandle | null;
}

export interface ProjectCanvasPoint {
  x: number;
  y: number;
}

export interface ProjectCanvasClosestHandleConnection {
  connection: Connection;
  distance: number;
  handle: ProjectCanvasConnectionHandle;
  x: number;
  y: number;
}

function handleId(handle: ProjectCanvasConnectionHandle): string | null {
  return handle.id ?? null;
}

function connectionHandleFromElement(
  element: Element
): ProjectCanvasConnectionHandle | undefined {
  if (!(element instanceof HTMLElement)) {
    return undefined;
  }
  const nodeId = element.getAttribute("data-nodeid");
  if (!nodeId) {
    return undefined;
  }
  let type: ProjectCanvasConnectionHandle["type"];
  if (element.classList.contains("target")) {
    type = "target";
  } else if (element.classList.contains("source")) {
    type = "source";
  }
  if (type === undefined) {
    return undefined;
  }
  return {
    id: element.getAttribute("data-handleid"),
    nodeId,
    type,
  };
}

function sameConnectionHandle(
  a: ProjectCanvasConnectionHandle,
  b: ProjectCanvasConnectionHandle
): boolean {
  return (
    a.nodeId === b.nodeId && handleId(a) === handleId(b) && a.type === b.type
  );
}

function defaultHandleCenter(element: Element): { x: number; y: number } {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

export function connectionHandleFromConnectStartParams(params: {
  handleId?: string | null;
  handleType?: HandleType | null;
  nodeId?: string | null;
}): ProjectCanvasConnectionHandle | null {
  if (params.nodeId == null || params.handleType == null) {
    return null;
  }
  return {
    id: params.handleId ?? null,
    nodeId: params.nodeId,
    type: params.handleType,
  };
}

export function connectionFromProjectCanvasHandles({
  fromHandle,
  toHandle,
}: {
  fromHandle?: ProjectCanvasConnectionHandle | null;
  toHandle?: ProjectCanvasConnectionHandle | null;
}): Connection | undefined {
  if (!(fromHandle?.nodeId && toHandle?.nodeId)) {
    return undefined;
  }

  if (fromHandle.type === "target") {
    return {
      source: toHandle.nodeId,
      sourceHandle: handleId(toHandle),
      target: fromHandle.nodeId,
      targetHandle: handleId(fromHandle),
    };
  }

  return {
    source: fromHandle.nodeId,
    sourceHandle: handleId(fromHandle),
    target: toHandle.nodeId,
    targetHandle: handleId(toHandle),
  };
}

export function connectionFromValidProjectCanvasLine({
  connectionStatus,
  fromHandle,
  toHandle,
}: {
  connectionStatus?: "valid" | "invalid" | null;
  fromHandle?: ProjectCanvasConnectionHandle | null;
  toHandle?: ProjectCanvasConnectionHandle | null;
}): Connection | undefined {
  if (connectionStatus !== "valid") {
    return undefined;
  }

  return connectionFromProjectCanvasHandles({ fromHandle, toHandle });
}

export function connectionFromSnappedProjectCanvasState(
  state: ProjectCanvasSnappedConnectionState
): Connection | undefined {
  if (state.isValid !== true || state.fromHandle == null) {
    return undefined;
  }
  return connectionFromProjectCanvasHandles({
    fromHandle: state.fromHandle,
    toHandle: state.toHandle,
  });
}

export function closestProjectCanvasHandleConnection({
  doc,
  fromHandle,
  isSupportedConnection,
  point,
  radius = PROJECT_CANVAS_CONNECTION_RADIUS,
  resolveHandleCenter = defaultHandleCenter,
}: {
  doc: Pick<Document, "querySelectorAll">;
  fromHandle?: ProjectCanvasConnectionHandle | null;
  isSupportedConnection: (connection: Connection) => boolean;
  point: ProjectCanvasPoint;
  radius?: number;
  resolveHandleCenter?: (element: Element) => ProjectCanvasPoint;
}): ProjectCanvasClosestHandleConnection | undefined {
  if (fromHandle == null) {
    return undefined;
  }

  let closest: ProjectCanvasClosestHandleConnection | undefined;

  for (const candidate of doc.querySelectorAll(
    PROJECT_CANVAS_HANDLE_SELECTOR
  )) {
    const toHandle = connectionHandleFromElement(candidate);
    if (toHandle === undefined || sameConnectionHandle(toHandle, fromHandle)) {
      continue;
    }
    const connection = connectionFromProjectCanvasHandles({
      fromHandle,
      toHandle,
    });
    if (connection === undefined || !isSupportedConnection(connection)) {
      continue;
    }

    const center = resolveHandleCenter(candidate);
    const distance = Math.hypot(point.x - center.x, point.y - center.y);
    if (distance > radius) {
      continue;
    }
    if (closest === undefined || distance < closest.distance) {
      closest = {
        connection,
        distance,
        handle: toHandle,
        x: center.x,
        y: center.y,
      };
    }
  }

  return closest;
}

function releasePointFromConnectEndEvent(event: MouseEvent | TouchEvent):
  | {
      doc: Document;
      x: number;
      y: number;
    }
  | undefined {
  const target =
    event.target instanceof Element ? event.target : event.currentTarget;
  const doc =
    target instanceof Element ? target.ownerDocument : globalThis.document;

  if ("changedTouches" in event) {
    const touch = event.changedTouches[0];
    if (touch === undefined) {
      return undefined;
    }
    return { doc, x: touch.clientX, y: touch.clientY };
  }

  return { doc, x: event.clientX, y: event.clientY };
}

export function connectionFromProjectCanvasReleaseEvent({
  event,
  fromHandle,
  isSupportedConnection,
  radius = PROJECT_CANVAS_CONNECTION_RADIUS,
}: {
  event: MouseEvent | TouchEvent;
  fromHandle?: ProjectCanvasConnectionHandle | null;
  isSupportedConnection: (connection: Connection) => boolean;
  radius?: number;
}): Connection | undefined {
  const point = releasePointFromConnectEndEvent(event);
  if (point === undefined) {
    return undefined;
  }

  return closestProjectCanvasHandleConnection({
    doc: point.doc,
    fromHandle,
    isSupportedConnection,
    point,
    radius,
  })?.connection;
}

export function connectionFromProjectCanvasConnectEndGesture({
  event,
  fallbackFromHandle,
  isSupportedConnection,
  radius = PROJECT_CANVAS_CONNECTION_RADIUS,
  snappedConnection,
  state,
}: {
  event: MouseEvent | TouchEvent;
  fallbackFromHandle?: ProjectCanvasConnectionHandle | null;
  isSupportedConnection: (connection: Connection) => boolean;
  radius?: number;
  snappedConnection?: Connection | null;
  state: ProjectCanvasSnappedConnectionState;
}): Connection | undefined {
  const fromHandle = state.fromHandle ?? fallbackFromHandle;
  const connection =
    connectionFromSnappedProjectCanvasState({
      fromHandle,
      isValid: state.isValid,
      toHandle: state.toHandle,
    }) ??
    snappedConnection ??
    connectionFromProjectCanvasReleaseEvent({
      event,
      fromHandle,
      isSupportedConnection,
      radius,
    });

  if (connection === undefined || !isSupportedConnection(connection)) {
    return undefined;
  }
  return connection;
}

export function projectCanvasInteractionProps({
  isValidConnection,
  onConnect,
  onConnectEnd,
  onConnectStart,
  readOnly,
}: ProjectCanvasInteractionOptions): ProjectCanvasInteractionProps {
  return {
    connectOnClick: false,
    connectionRadius: PROJECT_CANVAS_CONNECTION_RADIUS,
    edgesReconnectable: false,
    isValidConnection: readOnly ? () => false : isValidConnection,
    nodesConnectable: !readOnly,
    nodesDraggable: !readOnly,
    onConnect: readOnly ? () => undefined : onConnect,
    onConnectEnd: readOnly ? undefined : onConnectEnd,
    onConnectStart: readOnly ? undefined : onConnectStart,
  };
}
