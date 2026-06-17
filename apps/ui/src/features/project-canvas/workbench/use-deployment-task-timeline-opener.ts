"use client";

import { useCallback, useEffect } from "react";
import type { ProjectSideSurfaceEntry } from "@/features/project-surfaces/surface-state";
import {
  acknowledgePendingDeployTaskCreatedEvent,
  DEPLOY_TASK_CREATED_EVENT,
  type DeployTaskCreatedEvent,
  pendingDeployTaskCreatedEvents,
} from "@/lib/deploy-task/browser-events";

export function useDeploymentTaskTimelineOpener({
  openSideSurface,
  projectId,
}: {
  openSideSurface: (entry: ProjectSideSurfaceEntry) => void;
  projectId?: string;
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
      openSideSurface({
        kind: "deploymentTaskTimeline",
        projectId: currentProjectId,
        taskId: detail.taskId,
      });
      acknowledgePendingDeployTaskCreatedEvent(detail.taskId);
    },
    [openSideSurface, projectId]
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
