"use client";

import { createElement, useCallback, useState } from "react";
import type { ProjectResourceActions } from "@/features/project-resource-actions/resource-actions";
import {
  type ProjectCanvasApStopTarget,
  type ProjectCanvasDbStopTarget,
  ProjectCanvasStopDialogs,
} from "./project-canvas-stop-dialog";

export function useResourceStopDialogs({
  runResourceAction,
  stopApWorkload,
  stopDbWorkload,
}: {
  runResourceAction: ProjectResourceActions["runResourceAction"];
  stopApWorkload: ProjectResourceActions["apLifecycle"]["pauseWorkload"];
  stopDbWorkload: ProjectResourceActions["dbLifecycle"]["stopWorkload"];
}) {
  const [pendingApStopTarget, setPendingApStopTarget] =
    useState<ProjectCanvasApStopTarget | null>(null);
  const [pendingDbStopTarget, setPendingDbStopTarget] =
    useState<ProjectCanvasDbStopTarget | null>(null);

  const confirmPendingApStop = useCallback(() => {
    if (pendingApStopTarget == null) {
      return;
    }
    const target = pendingApStopTarget;
    setPendingApStopTarget(null);
    runResourceAction(
      () => stopApWorkload({ name: target.name, namespace: target.namespace }),
      {
        loading: `Stopping "${target.displayName}"...`,
        success: `Stop requested for "${target.displayName}"`,
      }
    );
  }, [pendingApStopTarget, runResourceAction, stopApWorkload]);

  const confirmPendingDbStop = useCallback(() => {
    if (pendingDbStopTarget == null) {
      return;
    }
    const target = pendingDbStopTarget;
    setPendingDbStopTarget(null);
    runResourceAction(
      () => stopDbWorkload({ name: target.name, namespace: target.namespace }),
      {
        loading: `Stopping "${target.displayName}"...`,
        success: `Stop requested for "${target.displayName}"`,
      }
    );
  }, [pendingDbStopTarget, runResourceAction, stopDbWorkload]);

  const resourceStopDialog = createElement(ProjectCanvasStopDialogs, {
    apTarget: pendingApStopTarget,
    dbTarget: pendingDbStopTarget,
    onApConfirm: confirmPendingApStop,
    onApOpenChange: (open: boolean) => {
      if (!open) {
        setPendingApStopTarget(null);
      }
    },
    onDbConfirm: confirmPendingDbStop,
    onDbOpenChange: (open: boolean) => {
      if (!open) {
        setPendingDbStopTarget(null);
      }
    },
  });

  return {
    requestApStop: setPendingApStopTarget,
    requestDbStop: setPendingDbStopTarget,
    resourceStopDialog,
  };
}
