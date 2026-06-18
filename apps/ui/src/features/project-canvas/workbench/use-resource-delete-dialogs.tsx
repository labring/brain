"use client";

import { createElement, useCallback, useState } from "react";
import type { CanvasLayoutResourceRef } from "@/features/project-canvas/layout/types";
import {
  type ProjectResourceActions,
  resourceLayoutRefsForApDelete,
  resourceLayoutRefsForDbDelete,
} from "@/features/project-resource-actions/resource-actions";
import {
  type ProjectCanvasApDeleteTarget,
  type ProjectCanvasDbDeleteTarget,
  ProjectCanvasDeleteDialogs,
} from "./project-canvas-delete-dialog";

export function useResourceDeleteDialogs({
  deleteApWorkload,
  deleteDbWorkload,
  onResourceLayoutDelete,
  runResourceAction,
}: {
  deleteApWorkload: ProjectResourceActions["apLifecycle"]["deleteWorkload"];
  deleteDbWorkload: ProjectResourceActions["dbLifecycle"]["deleteWorkload"];
  onResourceLayoutDelete?: (refs: readonly CanvasLayoutResourceRef[]) => void;
  runResourceAction: ProjectResourceActions["runResourceAction"];
}) {
  const [pendingApDeleteTarget, setPendingApDeleteTarget] =
    useState<ProjectCanvasApDeleteTarget | null>(null);
  const [pendingDbDeleteTarget, setPendingDbDeleteTarget] =
    useState<ProjectCanvasDbDeleteTarget | null>(null);

  const confirmPendingApDelete = useCallback(() => {
    if (pendingApDeleteTarget == null) {
      return;
    }
    const target = pendingApDeleteTarget;
    setPendingApDeleteTarget(null);
    runResourceAction(
      () =>
        deleteApWorkload({ name: target.name, namespace: target.namespace }),
      {
        loading: `Deleting "${target.displayName}"...`,
        success: `Deleted "${target.displayName}"`,
      },
      {
        onSuccess: () =>
          onResourceLayoutDelete?.(resourceLayoutRefsForApDelete(target)),
      }
    );
  }, [
    deleteApWorkload,
    onResourceLayoutDelete,
    pendingApDeleteTarget,
    runResourceAction,
  ]);

  const confirmPendingDbDelete = useCallback(() => {
    if (pendingDbDeleteTarget == null) {
      return;
    }
    const target = pendingDbDeleteTarget;
    setPendingDbDeleteTarget(null);
    runResourceAction(
      () =>
        deleteDbWorkload({
          name: target.name,
          namespace: target.namespace,
        }),
      {
        loading: `Deleting "${target.displayName}"...`,
        success: `Deleted "${target.displayName}"`,
      },
      {
        onSuccess: () =>
          onResourceLayoutDelete?.(resourceLayoutRefsForDbDelete(target)),
      }
    );
  }, [
    deleteDbWorkload,
    onResourceLayoutDelete,
    pendingDbDeleteTarget,
    runResourceAction,
  ]);

  const resourceDeleteDialog = createElement(ProjectCanvasDeleteDialogs, {
    apTarget: pendingApDeleteTarget,
    dbTarget: pendingDbDeleteTarget,
    onApConfirm: confirmPendingApDelete,
    onApOpenChange: (open: boolean) => {
      if (!open) {
        setPendingApDeleteTarget(null);
      }
    },
    onDbConfirm: confirmPendingDbDelete,
    onDbOpenChange: (open: boolean) => {
      if (!open) {
        setPendingDbDeleteTarget(null);
      }
    },
  });

  return {
    requestApDelete: setPendingApDeleteTarget,
    requestDbDelete: setPendingDbDeleteTarget,
    resourceDeleteDialog,
  };
}
