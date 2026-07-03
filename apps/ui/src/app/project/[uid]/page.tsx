"use client";

import { useAtomValue } from "jotai";
import { useParams } from "next/navigation";
import { useMemo } from "react";
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
import { kubeconfigAtom, namespaceAtom } from "@/store/auth-store";
import { assistantPaneResizingAtom } from "@/store/layout-store";

export default function ProjectIdPage() {
  const params = useParams<{ uid: string }>();
  const uid = decodeURIComponent(params.uid ?? "");
  const kubeconfig = useAtomValue(kubeconfigAtom);
  const namespace = useAtomValue(namespaceAtom);
  const projectCanvas = useProjectCanvasModule({
    kubeconfig,
    namespace,
    projectId: uid,
  });
  const { insets: canvasViewportInsets, rootRef: canvasViewportRootRef } =
    useProjectCanvasViewportInsets({
      drawerOpen: projectCanvas.surfaces.model.drawer != null,
      sideOpen: projectCanvas.surfaces.model.side != null,
    });
  const assistantPaneResizing = useAtomValue(assistantPaneResizingAtom);
  const canvasMeta = useMemo(() => {
    const baseMeta = projectCanvas.canvas.meta;
    return {
      ...baseMeta,
      viewportFocus:
        baseMeta.viewportFocus == null
          ? undefined
          : { ...baseMeta.viewportFocus, instant: assistantPaneResizing },
      viewportInsets: canvasViewportInsets,
    };
  }, [assistantPaneResizing, canvasViewportInsets, projectCanvas.canvas.meta]);
  const projectCanvasSidePaneSurface = useMemo<ProjectSidePaneAssistantSurface>(
    () => ({
      id: `project-canvas:${uid}`,
      openAssistantIntent: (intent) => {
        const surfaceIntent = projectCanvasEntryForAssistantIntent(intent, {
          projectId: uid,
        });
        if (surfaceIntent == null) {
          return { status: "ignored" as const };
        }
        projectCanvas.actions.openSurfaceIntent(surfaceIntent, "assistant");
        return { status: "handled" as const };
      },
    }),
    [projectCanvas.actions.openSurfaceIntent, uid]
  );
  useProjectSidePaneSurface(projectCanvasSidePaneSurface);
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      {projectCanvas.canvas.frameState.renderCanvas && (
        <div
          className="relative min-h-0 min-w-0 flex-1"
          ref={canvasViewportRootRef}
        >
          <ProjectCanvasViewport
            canvasKey={`${namespace}:${uid}`}
            commands={projectCanvas.canvas.nodeCommands}
            kubeconfig={kubeconfig}
            lifecycleActivity={projectCanvas.canvas.lifecycleActivityStore}
            meta={canvasMeta}
            runtimeStore={projectCanvas.canvas.runtimeStore}
            state={projectCanvas.canvas.state}
          />
          <ProjectCanvasOverlayLayer
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
            projectId={uid}
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
