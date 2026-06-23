"use client";

import { useAtomValue } from "jotai";
import { useParams } from "next/navigation";
import type { CSSProperties } from "react";
import { useMemo } from "react";
import { PROJECT_CANVAS_SIDE_PANE_RIGHT_INSET } from "@/features/project-canvas/workbench/canvas-meta";
import {
  ProjectCanvasOverlayLayer,
  ProjectCanvasViewport,
} from "@/features/project-canvas/workbench/project-canvas-page-shell";
import { ProjectCanvasSurfaceHost } from "@/features/project-canvas/workbench/project-canvas-workbench-surfaces";
import { useProjectCanvasModule } from "@/features/project-canvas/workbench/use-project-canvas-module";
import type { ProjectSidePaneAssistantSurface } from "@/features/project-surfaces/assistant-router";
import { useProjectSidePaneSurface } from "@/features/project-surfaces/react";
import { projectCanvasEntryForAssistantIntent } from "@/features/project-surfaces/surface-intents";
import { kubeconfigAtom, namespaceAtom } from "@/store/auth-store";

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
  const canvasViewportStyle = useMemo(
    () =>
      ({
        "--canvas-viewport-right-inset": `${
          projectCanvas.surfaces.model.side == null
            ? 0
            : PROJECT_CANVAS_SIDE_PANE_RIGHT_INSET
        }px`,
      }) as CSSProperties,
    [projectCanvas.surfaces.model.side]
  );
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
          style={canvasViewportStyle}
        >
          <ProjectCanvasViewport
            canvasKey={`${namespace}:${uid}`}
            decorators={projectCanvas.canvas.runtimeModelDecorators}
            kubeconfig={kubeconfig}
            meta={projectCanvas.canvas.meta}
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
