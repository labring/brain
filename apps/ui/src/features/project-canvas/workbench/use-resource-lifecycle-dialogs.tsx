"use client";

import { createElement, useCallback, useMemo, useState } from "react";
import type { ProjectResourceActions } from "@/features/project-canvas/actions/resource-actions";
import {
  type ProjectCanvasApLifecycleTarget,
  type ProjectCanvasDbLifecycleTarget,
  ProjectCanvasLifecycleDialogs,
} from "./project-canvas-lifecycle-dialog";

export function useResourceLifecycleDialogs({
  restartApWorkload,
  restartDbWorkload,
  runResourceAction,
  stopApWorkload,
  stopDbWorkload,
}: {
  restartApWorkload: ProjectResourceActions["apLifecycle"]["restartWorkload"];
  restartDbWorkload: ProjectResourceActions["dbLifecycle"]["restartWorkload"];
  runResourceAction: ProjectResourceActions["runResourceAction"];
  stopApWorkload: ProjectResourceActions["apLifecycle"]["pauseWorkload"];
  stopDbWorkload: ProjectResourceActions["dbLifecycle"]["stopWorkload"];
}) {
  const [pendingApRestartTarget, setPendingApRestartTarget] =
    useState<ProjectCanvasApLifecycleTarget | null>(null);
  const [pendingApStopTarget, setPendingApStopTarget] =
    useState<ProjectCanvasApLifecycleTarget | null>(null);
  const [pendingDbRestartTarget, setPendingDbRestartTarget] =
    useState<ProjectCanvasDbLifecycleTarget | null>(null);
  const [pendingDbStopTarget, setPendingDbStopTarget] =
    useState<ProjectCanvasDbLifecycleTarget | null>(null);

  const confirmPendingApRestart = useCallback(() => {
    if (pendingApRestartTarget == null) {
      return;
    }
    const target = pendingApRestartTarget;
    setPendingApRestartTarget(null);
    runResourceAction(
      () =>
        restartApWorkload({ name: target.name, namespace: target.namespace }),
      {
        loading: `Restarting "${target.displayName}"...`,
        success: `Restarted "${target.displayName}"`,
      }
    );
  }, [pendingApRestartTarget, restartApWorkload, runResourceAction]);

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

  const confirmPendingDbRestart = useCallback(() => {
    if (pendingDbRestartTarget == null) {
      return;
    }
    const target = pendingDbRestartTarget;
    setPendingDbRestartTarget(null);
    runResourceAction(
      () =>
        restartDbWorkload({ name: target.name, namespace: target.namespace }),
      {
        loading: `Restarting "${target.displayName}"...`,
        success: `Restart requested for "${target.displayName}"`,
      }
    );
  }, [pendingDbRestartTarget, restartDbWorkload, runResourceAction]);

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

  const resourceLifecycleDialogs = useMemo(
    () =>
      createElement(ProjectCanvasLifecycleDialogs, {
        apRestartTarget: pendingApRestartTarget,
        apStopTarget: pendingApStopTarget,
        dbRestartTarget: pendingDbRestartTarget,
        dbStopTarget: pendingDbStopTarget,
        onApRestartConfirm: confirmPendingApRestart,
        onApRestartOpenChange: (open: boolean) => {
          if (!open) {
            setPendingApRestartTarget(null);
          }
        },
        onApStopConfirm: confirmPendingApStop,
        onApStopOpenChange: (open: boolean) => {
          if (!open) {
            setPendingApStopTarget(null);
          }
        },
        onDbRestartConfirm: confirmPendingDbRestart,
        onDbRestartOpenChange: (open: boolean) => {
          if (!open) {
            setPendingDbRestartTarget(null);
          }
        },
        onDbStopConfirm: confirmPendingDbStop,
        onDbStopOpenChange: (open: boolean) => {
          if (!open) {
            setPendingDbStopTarget(null);
          }
        },
      }),
    [
      confirmPendingApRestart,
      confirmPendingApStop,
      confirmPendingDbRestart,
      confirmPendingDbStop,
      pendingApRestartTarget,
      pendingApStopTarget,
      pendingDbRestartTarget,
      pendingDbStopTarget,
    ]
  );

  return {
    requestApRestart: setPendingApRestartTarget,
    requestApStop: setPendingApStopTarget,
    requestDbRestart: setPendingDbRestartTarget,
    requestDbStop: setPendingDbStopTarget,
    resourceLifecycleDialogs,
  };
}
