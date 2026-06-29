"use client";

import { Canvas } from "@workspace/ui/components/canvas/canvas";
import type {
  CanvasMeta,
  CanvasState,
} from "@workspace/ui/components/canvas/canvas.types";
import { memo, useEffect, useLayoutEffect } from "react";
import { toast } from "sonner";
import type { ProjectCanvasFrameState } from "@/features/project-canvas/snapshot/project-canvas-page-state";
import { ProjectCanvasInteractionProvider } from "@/features/project-canvas/surface/interaction-react";
import { WorkloadTelemetryProvider } from "@/features/project-canvas/telemetry/workload-telemetry-react";
import type { DeploymentTaskDockModel } from "@/features/project-canvas/workbench/deployment-task-timeline-reentry";
import { ProjectCanvasDeploymentTaskDock } from "@/features/project-canvas/workbench/deployment-task-timeline-reentry-affordance";
import {
  type ProjectRuntimeNodeModelDecorators,
  ProjectRuntimeNodeModelDecoratorsProvider,
  ProjectRuntimeStoreProvider,
} from "@/features/project-runtime/resource-models-react";
import type { ProjectRuntimeStore } from "@/features/project-runtime/resource-store";

const PROJECT_CANVAS_LOADING_TOAST_ID = "project-canvas-loading-workloads";
const PROJECT_CANVAS_NO_WORKLOADS_TOAST_ID = "project-canvas-no-workloads";
const PROJECT_CANVAS_UNAVAILABLE_TOAST_ID =
  "project-canvas-workloads-unavailable";
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

interface ProjectCanvasViewportProps {
  canvasKey: string;
  decorators?: ProjectRuntimeNodeModelDecorators;
  kubeconfig: string;
  meta?: CanvasMeta;
  runtimeStore: ProjectRuntimeStore;
  state: CanvasState;
}

export const ProjectCanvasViewport = memo(function ProjectCanvasViewport({
  canvasKey,
  decorators,
  kubeconfig,
  meta,
  runtimeStore,
  state,
}: ProjectCanvasViewportProps) {
  return (
    <WorkloadTelemetryProvider kubeconfig={kubeconfig}>
      <ProjectRuntimeStoreProvider store={runtimeStore}>
        <ProjectRuntimeNodeModelDecoratorsProvider decorators={decorators}>
          <ProjectCanvasInteractionProvider state={state}>
            <Canvas.Root key={canvasKey} meta={meta} state={state}>
              <Canvas.Flow>
                <Canvas.MiniMap />
                <Canvas.Controls />
              </Canvas.Flow>
            </Canvas.Root>
          </ProjectCanvasInteractionProvider>
        </ProjectRuntimeNodeModelDecoratorsProvider>
      </ProjectRuntimeStoreProvider>
    </WorkloadTelemetryProvider>
  );
});

function ProjectCanvasLoadingToast({ active }: { active: boolean }) {
  useIsomorphicLayoutEffect(() => {
    if (!active) {
      toast.dismiss(PROJECT_CANVAS_LOADING_TOAST_ID);
      return;
    }

    toast.loading("Loading workloads...", {
      id: PROJECT_CANVAS_LOADING_TOAST_ID,
    });

    return () => {
      toast.dismiss(PROJECT_CANVAS_LOADING_TOAST_ID);
    };
  }, [active]);

  return null;
}

function ProjectCanvasFrameStateToast({
  overlay,
}: {
  overlay: ProjectCanvasFrameState["overlay"];
}) {
  useIsomorphicLayoutEffect(() => {
    if (overlay === "empty") {
      toast.dismiss(PROJECT_CANVAS_UNAVAILABLE_TOAST_ID);
      toast.info("No workloads", {
        duration: Number.POSITIVE_INFINITY,
        id: PROJECT_CANVAS_NO_WORKLOADS_TOAST_ID,
      });

      return () => {
        toast.dismiss(PROJECT_CANVAS_NO_WORKLOADS_TOAST_ID);
      };
    }

    if (overlay === "error") {
      toast.dismiss(PROJECT_CANVAS_NO_WORKLOADS_TOAST_ID);
      toast.error("Workloads unavailable", {
        duration: Number.POSITIVE_INFINITY,
        id: PROJECT_CANVAS_UNAVAILABLE_TOAST_ID,
      });

      return () => {
        toast.dismiss(PROJECT_CANVAS_UNAVAILABLE_TOAST_ID);
      };
    }

    toast.dismiss(PROJECT_CANVAS_NO_WORKLOADS_TOAST_ID);
    toast.dismiss(PROJECT_CANVAS_UNAVAILABLE_TOAST_ID);
  }, [overlay]);

  return null;
}

interface ProjectCanvasOverlayLayerProps {
  deploymentTaskDock: DeploymentTaskDockModel;
  frameState: ProjectCanvasFrameState;
  onDismissDeploymentTask: (taskId: string) => void;
  onOpenDeploymentTask: (taskId: string) => void;
}

export function ProjectCanvasOverlayLayer({
  deploymentTaskDock,
  frameState,
  onDismissDeploymentTask,
  onOpenDeploymentTask,
}: ProjectCanvasOverlayLayerProps) {
  return (
    <>
      <ProjectCanvasDeploymentTaskDock
        className="absolute top-2 left-48 z-20"
        dock={deploymentTaskDock}
        onDismiss={onDismissDeploymentTask}
        onOpen={onOpenDeploymentTask}
      />
      <ProjectCanvasLoadingToast active={frameState.overlay === "loading"} />
      <ProjectCanvasFrameStateToast overlay={frameState.overlay} />
    </>
  );
}
