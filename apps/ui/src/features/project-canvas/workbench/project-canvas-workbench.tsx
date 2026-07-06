"use client";

import { useAtomValue } from "jotai";
import { Activity, useLayoutEffect, useMemo } from "react";
import {
  ProjectCanvasOverlayLayer,
  ProjectCanvasViewport,
} from "@/features/project-canvas/workbench/project-canvas-page-shell";
import { useProjectCanvasViewportInsets } from "@/features/project-canvas/workbench/project-canvas-viewport-insets";
import { ProjectCanvasSurfaceHost } from "@/features/project-canvas/workbench/project-canvas-workbench-surfaces";
import { useProjectCanvasModule } from "@/features/project-canvas/workbench/use-project-canvas-module";
import type { ProjectSidePaneAssistantSurface } from "@/features/project-surfaces/assistant-router";
import { useProjectSidePaneSurface } from "@/features/project-surfaces/react";
import { projectCanvasEntryForAssistantIntent } from "@/features/project-surfaces/surface-intents";
import { useDeploymentTaskActions } from "@/lib/deploy-task/use-deployment-task-actions";
import { assistantPaneResizingAtom } from "@/store/layout-store";

/**
 * Project Canvas workbench controller: hosts the canvas module (the single
 * route-state subscriber), writes viewport directives, and renders the
 * canvas viewport, overlay layer, and surface host. The canvas viewport's
 * inputs are all referentially stable stores, so controller re-renders
 * (route changes, resource polling) stop at its memo boundary.
 */
export function ProjectCanvasWorkbench({
  kubeconfig,
  namespace,
  projectId,
}: {
  kubeconfig: string;
  namespace: string;
  projectId: string;
}) {
  const projectCanvas = useProjectCanvasModule({
    kubeconfig,
    namespace,
    projectId,
  });
  const deploymentTaskActions = useDeploymentTaskActions({
    kubeconfig,
    namespace,
  });
  const { insets: canvasViewportInsets, rootRef: canvasViewportRootRef } =
    useProjectCanvasViewportInsets({
      drawerOpen: projectCanvas.surfaces.model.drawer != null,
      sideOpen: projectCanvas.surfaces.model.side != null,
    });
  const assistantPaneResizing = useAtomValue(assistantPaneResizingAtom);
  const viewportDirectives = projectCanvas.canvas.viewportDirectives;
  useLayoutEffect(() => {
    viewportDirectives.setInsets(canvasViewportInsets);
  }, [canvasViewportInsets, viewportDirectives]);
  useLayoutEffect(() => {
    viewportDirectives.setInstant(assistantPaneResizing);
  }, [assistantPaneResizing, viewportDirectives]);
  const projectCanvasSidePaneSurface = useMemo<ProjectSidePaneAssistantSurface>(
    () => ({
      id: `project-canvas:${projectId}`,
      openAssistantIntent: (intent) => {
        const surfaceIntent = projectCanvasEntryForAssistantIntent(intent, {
          projectId,
        });
        if (surfaceIntent == null) {
          return { status: "ignored" as const };
        }
        projectCanvas.actions.openSurfaceIntent(surfaceIntent, "assistant");
        return { status: "handled" as const };
      },
    }),
    [projectCanvas.actions.openSurfaceIntent, projectId]
  );
  useProjectSidePaneSurface(projectCanvasSidePaneSurface);
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      {projectCanvas.canvas.frameState.renderCanvas && (
        <div
          className="relative min-h-0 min-w-0 flex-1"
          ref={canvasViewportRootRef}
        >
          <Activity
            mode={projectCanvas.canvas.covered ? "hidden" : "visible"}
            name="project-canvas-viewport"
          >
            <ProjectCanvasViewport
              canvasKey={`${namespace}:${projectId}`}
              commands={projectCanvas.canvas.nodeCommands}
              interactionStore={projectCanvas.canvas.interactionStore}
              kubeconfig={kubeconfig}
              lifecycleActivity={projectCanvas.canvas.lifecycleActivityStore}
              meta={projectCanvas.canvas.meta}
              onAutoLayout={projectCanvas.canvas.autoLayout}
              runtimeStore={projectCanvas.canvas.runtimeStore}
            />
          </Activity>
          <ProjectCanvasOverlayLayer
            deploymentTaskActions={deploymentTaskActions}
            deploymentTaskDock={projectCanvas.canvas.deploymentTaskDock}
            frameState={projectCanvas.canvas.frameState}
            onDismissDeploymentTask={
              projectCanvas.actions.dismissDeploymentTaskDockTask
            }
            onOpenDeploymentTask={
              projectCanvas.actions.openDeploymentTaskDockTask
            }
          />
          <ProjectCanvasSurfaceHost
            actions={projectCanvas.surfaces.actions}
            dialogs={projectCanvas.surfaces.dialogs}
            kubeconfig={kubeconfig}
            namespace={namespace}
            projectId={projectId}
            refreshWorkloadLists={projectCanvas.surfaces.refreshWorkloadLists}
            settingsLaunchContext={projectCanvas.surfaces.settingsLaunchContext}
            settingsReadModelHints={
              projectCanvas.surfaces.settingsReadModelHints
            }
            settingsSessionEvents={projectCanvas.surfaces.settingsSessionEvents}
            surfaceModel={projectCanvas.surfaces.model}
          />
        </div>
      )}
    </div>
  );
}
