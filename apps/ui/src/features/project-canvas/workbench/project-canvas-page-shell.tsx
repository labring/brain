"use client";

import { Canvas } from "@workspace/ui/components/canvas/canvas";
import type {
  CanvasMeta,
  CanvasState,
} from "@workspace/ui/components/canvas/canvas.types";
import { Spinner } from "@workspace/ui/components/spinner";
import { memo } from "react";
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
      {frameState.overlay === "loading" ? (
        <div
          aria-live="polite"
          className="pointer-events-none absolute bottom-4 left-4 z-10 max-w-[min(100%-2rem,20rem)]"
          data-slot="project-canvas-loading-toast"
          role="status"
        >
          <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 shadow-md">
            <Spinner
              aria-hidden
              className="size-4 shrink-0 text-muted-foreground"
            />
            <span className="font-medium text-foreground text-sm">
              Loading workloads…
            </span>
          </div>
        </div>
      ) : null}
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
