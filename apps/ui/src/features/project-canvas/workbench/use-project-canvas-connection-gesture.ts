"use client";

import type { CanvasReactFlowProps } from "@workspace/ui/components/canvas/canvas.types";
import type { Connection, Node } from "@xyflow/react";
import { useCallback, useMemo, useRef, useState } from "react";
import { isProjectCanvasConnectionSupported } from "@/features/project-canvas/flow/connection-command";
import { createProjectCanvasConnectionLine } from "@/features/project-canvas/flow/connection-line";
import {
  connectionFromProjectCanvasConnectEndGesture,
  connectionHandleFromConnectStartParams,
  type ProjectCanvasConnectionHandle,
} from "@/features/project-canvas/flow/interaction";
import { useStableCallback } from "@/features/project-canvas/use-stable-callback";
import {
  connectionOriginFromHandle,
  type ProjectCanvasConnectionOrigin,
} from "@/features/project-canvas/workbench/canvas-meta";
import {
  type ProjectCanvasCommandPlan,
  planProjectCanvasCommand,
} from "@/features/project-canvas/workbench/command-model";

export function useProjectCanvasConnectionGesture({
  executeCommandPlan,
  nodes,
  readOnly,
}: {
  executeCommandPlan: (plan: ProjectCanvasCommandPlan) => void;
  nodes: Node[];
  readOnly: boolean;
}) {
  const connectHandledInGestureRef = useRef(false);
  const connectingFromHandleRef = useRef<ProjectCanvasConnectionHandle | null>(
    null
  );
  const snappedConnectionInGestureRef = useRef<Connection | null>(null);
  const [connectionOrigin, setConnectionOrigin] =
    useState<ProjectCanvasConnectionOrigin | null>(null);
  const [connectionGestureActive, setConnectionGestureActive] = useState(false);

  const handleConnect = useStableCallback<
    Parameters<NonNullable<CanvasReactFlowProps["onConnect"]>>,
    void
  >((connection) => {
    connectHandledInGestureRef.current = true;
    executeCommandPlan(
      planProjectCanvasCommand({
        intent: { connection, kind: "connectingEdge" },
        nodes,
        readOnly,
      })
    );
  });

  const isSupportedCanvasConnection = useStableCallback(
    (connection: Connection) =>
      isProjectCanvasConnectionSupported({
        connection,
        nodes,
        readOnly,
      })
  );

  const handleConnectStart = useCallback<
    NonNullable<CanvasReactFlowProps["onConnectStart"]>
  >((_event, params) => {
    connectHandledInGestureRef.current = false;
    const fromHandle = connectionHandleFromConnectStartParams(params);
    connectingFromHandleRef.current = fromHandle;
    snappedConnectionInGestureRef.current = null;
    setConnectionOrigin(connectionOriginFromHandle(fromHandle));
    setConnectionGestureActive(true);
  }, []);

  const handleConnectEnd = useCallback<
    NonNullable<CanvasReactFlowProps["onConnectEnd"]>
  >(
    (event, connectionState) => {
      if (!connectHandledInGestureRef.current) {
        const connection = connectionFromProjectCanvasConnectEndGesture({
          event,
          fallbackFromHandle: connectingFromHandleRef.current,
          isSupportedConnection: isSupportedCanvasConnection,
          snappedConnection: snappedConnectionInGestureRef.current,
          state: connectionState,
        });
        if (connection !== undefined) {
          handleConnect(connection);
        }
      }
      connectHandledInGestureRef.current = false;
      connectingFromHandleRef.current = null;
      snappedConnectionInGestureRef.current = null;
      setConnectionOrigin(null);
      setConnectionGestureActive(false);
    },
    [handleConnect, isSupportedCanvasConnection]
  );

  const isValidCanvasConnection = useCallback<
    NonNullable<CanvasReactFlowProps["isValidConnection"]>
  >(
    (connection) =>
      isSupportedCanvasConnection({
        source: connection.source,
        sourceHandle: connection.sourceHandle ?? null,
        target: connection.target,
        targetHandle: connection.targetHandle ?? null,
      }),
    [isSupportedCanvasConnection]
  );

  const projectCanvasConnectionLine = useMemo(
    () =>
      createProjectCanvasConnectionLine({
        isSupportedConnection: isSupportedCanvasConnection,
        onSnappedConnectionChange: (connection) => {
          snappedConnectionInGestureRef.current = connection;
        },
      }),
    [isSupportedCanvasConnection]
  );

  return {
    connectionGestureActive,
    connectionOrigin,
    handleConnect,
    handleConnectEnd,
    handleConnectStart,
    isValidCanvasConnection,
    projectCanvasConnectionLine,
  };
}
