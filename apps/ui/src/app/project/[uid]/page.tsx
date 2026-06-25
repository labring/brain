"use client";

import { useAtomValue } from "jotai";
import { useParams } from "next/navigation";
import type { CSSProperties } from "react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
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

const PROJECT_CANVAS_SESSION_DRAWER_BOTTOM_INSET = 288;

function activeSurfaceElement(
  root: HTMLElement,
  selector: string
): HTMLElement | null {
  const element = root.querySelector<HTMLElement>(selector);
  if (element == null || element.getAttribute("aria-hidden") === "true") {
    return null;
  }
  return element;
}

function useProjectCanvasViewportInsets(input: {
  drawerOpen: boolean;
  sideOpen: boolean;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [insets, setInsets] = useState(() => ({
    bottom: input.drawerOpen ? PROJECT_CANVAS_SESSION_DRAWER_BOTTOM_INSET : 0,
    right: input.sideOpen ? PROJECT_CANVAS_SIDE_PANE_RIGHT_INSET : 0,
  }));

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (root == null) {
      return;
    }

    let frame = 0;
    let resizeObserver: ResizeObserver;
    const observedElements = new WeakSet<Element>();
    const observeElement = (element: Element) => {
      if (observedElements.has(element)) {
        return;
      }
      observedElements.add(element);
      resizeObserver.observe(element);
    };
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rootRect = root.getBoundingClientRect();
        const sidePane = activeSurfaceElement(root, '[data-slot="side-pane"]');
        const drawer = activeSurfaceElement(
          root,
          '[data-slot="exec-terminal-plane"]'
        );
        if (sidePane != null) {
          observeElement(sidePane);
        }
        if (drawer != null) {
          observeElement(drawer);
        }
        const sideRect = sidePane?.getBoundingClientRect();
        const drawerRect = drawer?.getBoundingClientRect();
        const right =
          sideRect == null
            ? 0
            : Math.max(
                0,
                Math.min(rootRect.width, rootRect.right - sideRect.left)
              );
        const bottom =
          drawerRect == null
            ? 0
            : Math.max(
                0,
                Math.min(rootRect.height, rootRect.bottom - drawerRect.top)
              );

        setInsets((current) =>
          current.right === right && current.bottom === bottom
            ? current
            : { bottom, right }
        );
      });
    };

    resizeObserver = new ResizeObserver(measure);
    const mutationObserver = new MutationObserver(measure);
    observeElement(root);
    mutationObserver.observe(root, {
      attributes: true,
      childList: true,
      subtree: true,
    });
    measure();

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, []);

  return { insets, rootRef };
}

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
  const canvasViewportStyle = useMemo(
    () =>
      ({
        "--canvas-viewport-bottom-inset": `${canvasViewportInsets.bottom}px`,
        "--canvas-viewport-right-inset": `${canvasViewportInsets.right}px`,
      }) as CSSProperties,
    [canvasViewportInsets]
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
          ref={canvasViewportRootRef}
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
