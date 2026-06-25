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
        className="absolute top-4 left-4 z-20"
        dock={deploymentTaskDock}
        onDismiss={onDismissDeploymentTask}
        onOpen={onOpenDeploymentTask}
      />
      <ProjectCanvasLoadingToast active={frameState.overlay === "loading"} />
      {frameState.overlay === "error" || frameState.overlay === "empty" ? (
        <div
          aria-live="polite"
          className="pointer-events-none absolute top-6 left-1/2 z-10 -translate-x-1/2"
          data-slot="project-canvas-empty-state"
          role="status"
        >
          <div className="rounded-lg border border-border bg-card px-4 py-2 shadow-md">
            <span className="font-medium text-foreground text-sm">
              {frameState.overlay === "error"
                ? "Workloads unavailable"
                : "No workloads"}
            </span>
          </div>
        </div>
      ) : null}
    </>
  );
}
