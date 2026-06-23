"use client";

import { Canvas } from "@workspace/ui/components/canvas/canvas";
import { Spinner } from "@workspace/ui/components/spinner";
import { useAtomValue } from "jotai";
import { useParams } from "next/navigation";
import { useMemo } from "react";
import { ProjectCanvasInteractionProvider } from "@/features/project-canvas/surface/interaction-react";
import { WorkloadTelemetryProvider } from "@/features/project-canvas/telemetry/workload-telemetry-react";
import { ProjectCanvasDeploymentTaskDock } from "@/features/project-canvas/workbench/deployment-task-timeline-reentry-affordance";
import { ProjectCanvasSurfaceHost } from "@/features/project-canvas/workbench/project-canvas-workbench-surfaces";
import { useProjectCanvasModule } from "@/features/project-canvas/workbench/use-project-canvas-module";
import {
  ProjectRuntimeNodeModelDecoratorsProvider,
  ProjectRuntimeStoreProvider,
} from "@/features/project-runtime/resource-models-react";
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
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <WorkloadTelemetryProvider
            kubeconfig={kubeconfig}
            selectedTarget={projectCanvas.canvas.selectedTelemetryTarget}
          >
            <ProjectRuntimeStoreProvider
              store={projectCanvas.canvas.runtimeStore}
            >
              <ProjectRuntimeNodeModelDecoratorsProvider
                decorators={projectCanvas.canvas.runtimeModelDecorators}
              >
                <ProjectCanvasInteractionProvider
                  state={projectCanvas.canvas.state}
                >
                  <Canvas.Root
                    key={`${namespace}:${uid}`}
                    meta={projectCanvas.canvas.meta}
                    state={projectCanvas.canvas.state}
                  >
                    <div className="relative min-h-0 flex-1">
                      <ProjectCanvasDeploymentTaskDock
                        className="absolute top-4 left-4 z-20"
                        dock={projectCanvas.canvas.deploymentTaskDock}
                        onDismiss={
                          projectCanvas.actions.dismissDeploymentTaskDockTask
                        }
                        onOpen={
                          projectCanvas.actions.openDeploymentTaskDockTask
                        }
                      />
                      {projectCanvas.canvas.frameState.overlay === "loading" ? (
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
                      {projectCanvas.canvas.frameState.overlay === "error" ||
                      projectCanvas.canvas.frameState.overlay === "empty" ? (
                        <div
                          aria-live="polite"
                          className="pointer-events-none absolute top-6 left-1/2 z-10 -translate-x-1/2"
                          data-slot="project-canvas-empty-state"
                          role="status"
                        >
                          <div className="rounded-lg border border-border bg-card px-4 py-2 shadow-md">
                            <span className="font-medium text-foreground text-sm">
                              {projectCanvas.canvas.frameState.overlay ===
                              "error"
                                ? "Workloads unavailable"
                                : "No workloads"}
                            </span>
                          </div>
                        </div>
                      ) : null}
                      <Canvas.Flow>
                        <Canvas.MiniMap
                          rightInset={projectCanvas.canvas.viewportInset}
                        />
                        <Canvas.Controls
                          rightInset={projectCanvas.canvas.viewportInset}
                        />
                        <ProjectCanvasSurfaceHost
                          actions={projectCanvas.surfaces.actions}
                          dialogs={projectCanvas.surfaces.dialogs}
                          kubeconfig={kubeconfig}
                          namespace={namespace}
                          projectId={uid}
                          refreshWorkloadLists={
                            projectCanvas.surfaces.refreshWorkloadLists
                          }
                          settingsLaunchContext={
                            projectCanvas.surfaces.settingsLaunchContext
                          }
                          settingsReadModelHints={
                            projectCanvas.surfaces.settingsReadModelHints
                          }
                          settingsSessionEvents={
                            projectCanvas.surfaces.settingsSessionEvents
                          }
                          surfaceModel={projectCanvas.surfaces.model}
                        />
                      </Canvas.Flow>
                    </div>
                  </Canvas.Root>
                </ProjectCanvasInteractionProvider>
              </ProjectRuntimeNodeModelDecoratorsProvider>
            </ProjectRuntimeStoreProvider>
          </WorkloadTelemetryProvider>
        </div>
      )}
    </div>
  );
}
