"use client";

import { useCallback, useEffect } from "react";
import {
  acknowledgePendingDeployTaskCreatedEvent,
  DEPLOY_TASK_CREATED_EVENT,
  type DeployTaskCreatedEvent,
  pendingDeployTaskCreatedEvents,
} from "@/features/deploy/task/browser-events";
import type { ProjectSideSurfaceEntry } from "@/features/project-surfaces/surface-state";

export function useDeploymentTaskTimelineOpener({
  openSideSurface,
  projectId,
  shouldOpenTask,
}: {
  openSideSurface: (entry: ProjectSideSurfaceEntry) => void;
  projectId?: string;
  shouldOpenTask?: (taskId: string) => boolean;
}) {
  const openDeploymentTaskTimeline = useCallback(
    (detail: DeployTaskCreatedEvent["detail"]) => {
      const currentProjectId = projectId?.trim();
      const detailProjectId = detail.projectId?.trim();
      if (
        currentProjectId == null ||
        currentProjectId === "" ||
        detail.taskId.trim() === "" ||
        detailProjectId !== currentProjectId
      ) {
        return;
      }
      if (shouldOpenTask?.(detail.taskId) === false) {
        acknowledgePendingDeployTaskCreatedEvent(detail.taskId);
        return;
      }
      openSideSurface({
        kind: "deploymentTaskTimeline",
        projectId: currentProjectId,
        taskId: detail.taskId,
      });
      acknowledgePendingDeployTaskCreatedEvent(detail.taskId);
    },
    [openSideSurface, projectId, shouldOpenTask]
  );

  useEffect(() => {
    const onDeployTaskCreated = (event: Event) => {
      openDeploymentTaskTimeline((event as DeployTaskCreatedEvent).detail);
    };

    for (const pending of pendingDeployTaskCreatedEvents()) {
      openDeploymentTaskTimeline(pending);
    }
    window.addEventListener(DEPLOY_TASK_CREATED_EVENT, onDeployTaskCreated);
    return () => {
      window.removeEventListener(
        DEPLOY_TASK_CREATED_EVENT,
        onDeployTaskCreated
      );
    };
  }, [openDeploymentTaskTimeline]);
}
