"use client";

import type { Node } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProjectCanvasSelection } from "@/features/panes/canvas-selection";
import type { ProjectMainSurfaceEntry } from "@/features/panes/surface-state";
import type { ProjectDbTarget } from "@/features/panes/target-identity";
import { findCanvasNodeForProjectTarget } from "@/features/project-canvas/surface/selection";
import {
  canvasSelectionForRestoredDbService,
  DB_RESTORE_CANVAS_FOCUS_TIMEOUT_MS,
  type PendingDbServiceRestoreFocus,
  restoredDbServiceTargetFromAccepted,
  shouldCancelPendingDbServiceRestoreFocus,
} from "./db-restore-focus";

export function useDbServiceRestoreFocus({
  focusCanvasSelection,
  mainSurface,
  nodes,
  refreshWorkloadLists,
}: {
  focusCanvasSelection: (selection: ProjectCanvasSelection) => void;
  mainSurface: ProjectMainSurfaceEntry | null;
  nodes: Node[];
  refreshWorkloadLists?: () => Promise<unknown>;
}) {
  const dbServiceRestoreFocusId = useRef(0);
  const [pendingDbServiceRestoreFocus, setPendingDbServiceRestoreFocus] =
    useState<PendingDbServiceRestoreFocus | null>(null);
  const [
    restoredDbServiceViewportFocusTarget,
    setRestoredDbServiceViewportFocusTarget,
  ] = useState<ProjectDbTarget | null>(null);

  const onDbServiceRestoreAccepted = useCallback(
    (target: { name: string; namespace: string }) => {
      const restoredTarget = restoredDbServiceTargetFromAccepted(target);
      const sourceTarget =
        mainSurface?.kind === "dbAccess" ? mainSurface.target : null;
      refreshWorkloadLists?.().catch(() => undefined);

      if (restoredTarget == null || sourceTarget == null) {
        return;
      }

      dbServiceRestoreFocusId.current += 1;
      setPendingDbServiceRestoreFocus({
        id: dbServiceRestoreFocusId.current,
        restoredTarget,
        sourceTarget,
      });
    },
    [mainSurface, refreshWorkloadLists]
  );

  const pendingDbServiceRestoreFocusNode = useMemo(
    () =>
      pendingDbServiceRestoreFocus == null
        ? null
        : findCanvasNodeForProjectTarget(
            nodes,
            pendingDbServiceRestoreFocus.restoredTarget
          ),
    [nodes, pendingDbServiceRestoreFocus]
  );

  const restoredDbServiceViewportFocusNodeId = useMemo(
    () =>
      restoredDbServiceViewportFocusTarget == null
        ? null
        : (findCanvasNodeForProjectTarget(
            nodes,
            restoredDbServiceViewportFocusTarget
          )?.id ?? null),
    [nodes, restoredDbServiceViewportFocusTarget]
  );

  if (pendingDbServiceRestoreFocus != null) {
    if (
      shouldCancelPendingDbServiceRestoreFocus({
        main: mainSurface,
        pending: pendingDbServiceRestoreFocus,
      })
    ) {
      setPendingDbServiceRestoreFocus(null);
    } else if (pendingDbServiceRestoreFocusNode != null) {
      setPendingDbServiceRestoreFocus(null);
      setRestoredDbServiceViewportFocusTarget(
        pendingDbServiceRestoreFocus.restoredTarget
      );
    }
  }

  useEffect(() => {
    if (pendingDbServiceRestoreFocus == null) {
      return;
    }
    const pendingId = pendingDbServiceRestoreFocus.id;
    const timeout = window.setTimeout(() => {
      setPendingDbServiceRestoreFocus((current) =>
        current?.id === pendingId ? null : current
      );
    }, DB_RESTORE_CANVAS_FOCUS_TIMEOUT_MS);
    return () => window.clearTimeout(timeout);
  }, [pendingDbServiceRestoreFocus]);

  useEffect(() => {
    if (restoredDbServiceViewportFocusTarget == null) {
      return;
    }
    focusCanvasSelection(
      canvasSelectionForRestoredDbService(restoredDbServiceViewportFocusTarget)
    );
  }, [focusCanvasSelection, restoredDbServiceViewportFocusTarget]);

  const clearRestoredDbServiceViewportFocus = useCallback(() => {
    setRestoredDbServiceViewportFocusTarget(null);
  }, []);

  return {
    clearRestoredDbServiceViewportFocus,
    onDbServiceRestoreAccepted,
    restoredDbServiceViewportFocusNodeId,
  };
}
