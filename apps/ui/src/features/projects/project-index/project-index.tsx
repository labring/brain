"use client";

import { SidePanePresence } from "@workspace/ui/components/side-pane";
import { cn } from "@workspace/ui/lib/utils";
import { useAtomValue } from "jotai";
import { useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useMemo } from "react";
import { parseTemplateForm } from "@/features/deploy/template-deployment-intent";
import type { ProjectSidePaneAssistantSurface } from "@/features/panes/assistant-router";
import { useProjectSidePaneSurface } from "@/features/panes/react";
import { PROJECT_SIDE_QUERY_KEY } from "@/features/panes/side-url-codec";
import { projectListEntryForAssistantIntent } from "@/features/panes/surface-intents";
import { serializeProjectSideSurfaceEntry } from "@/features/panes/url-codec";
import { useProjectSideRouteState } from "@/features/panes/use-project-side-route-state";
import { ProjectCreationPane } from "@/features/projects/creation/project-creation-pane";
import type { ProjectCreationPaneEntryMode } from "@/features/projects/creation/project-creation-pane-state";
import {
  type ProjectCreatedContext,
  useProjectCreator,
} from "@/features/projects/creation/use-project-creator";
import { ProjectExplorer } from "@/features/projects/explorer/project-explorer";
import { useProjectsExplorer } from "@/features/projects/explorer/use-projects-explorer";
import { kubeconfigAtom, namespaceAtom } from "@/lib/auth-store";
import { SealosSkillsWorkflowPane } from "@/lib/sealos-skills-workflow-pane";
import { useEnterMotionFrames } from "@/lib/use-enter-motion-frames";
import { ProjectIndexHorizon } from "./horizon/project-index-horizon";
import styles from "./project-index.module.css";
import { useSidePaneReserveFlip } from "./use-side-pane-reserve-flip";

export function ProjectIndex() {
  const router = useRouter();
  const kubeconfig = useAtomValue(kubeconfigAtom).trim();
  const ns = useAtomValue(namespaceAtom);

  const { actions, states, refreshProjects } = useProjectsExplorer({
    kubeconfig,
    ns,
  });
  const {
    closeSide: closeProjectSideRoute,
    openSide: openProjectSideRoute,
    side: projectSideRouteEntry,
  } = useProjectSideRouteState({
    isSideEntrySupported: (entry) =>
      entry.kind === "projectCreation" || entry.kind === "skillsWorkflow",
  });
  const creationSideEntry =
    projectSideRouteEntry?.kind === "projectCreation"
      ? projectSideRouteEntry
      : null;
  const creationSideEntryMode = creationSideEntry?.entryMode ?? null;
  const creationSideTemplateName =
    creationSideEntry?.entryMode === "templateDirect"
      ? creationSideEntry.templateName
      : undefined;
  const creationSideTemplateArgs = useMemo(() => {
    if (creationSideEntry?.entryMode !== "templateDirect") {
      return undefined;
    }
    return parseTemplateForm(creationSideEntry.templateForm) ?? undefined;
  }, [creationSideEntry]);

  const onProjectCreated = useCallback(
    async (projectId: string | undefined, context?: ProjectCreatedContext) => {
      await refreshProjects();
      const resolvedProjectId = projectId?.trim();
      if (resolvedProjectId) {
        const projectPath = `/project/${encodeURIComponent(resolvedProjectId)}`;
        const deploymentTaskId = context?.deploymentTaskId?.trim();
        if (deploymentTaskId == null || deploymentTaskId === "") {
          router.push(projectPath);
          return;
        }
        const side = serializeProjectSideSurfaceEntry({
          kind: "deploymentTaskTimeline",
          projectId: resolvedProjectId,
          taskId: deploymentTaskId,
        });
        const query = new URLSearchParams();
        if (side != null) {
          query.set(PROJECT_SIDE_QUERY_KEY, side);
        }
        const queryString = query.toString();
        router.push(
          queryString === "" ? projectPath : `${projectPath}?${queryString}`
        );
        return;
      }
      closeProjectSideRoute("replace");
    },
    [closeProjectSideRoute, refreshProjects, router]
  );

  const {
    creationPaneEntryMode,
    creatorRootProps,
    creatorResetKey,
    githubDeployerLoading,
    onCreationPaneOpenChange,
    onCreationPaneSourceChange,
    openCreationPane: prepareCreationPane,
  } = useProjectCreator({
    kubeconfig,
    namespace: ns,
    onProjectCreated,
  });
  useEffect(() => {
    if (creationSideEntryMode == null) {
      onCreationPaneOpenChange(false);
      return;
    }
    prepareCreationPane(
      creationSideEntryMode,
      creationSideTemplateName,
      creationSideTemplateArgs
    );
  }, [
    creationSideEntryMode,
    creationSideTemplateArgs,
    creationSideTemplateName,
    onCreationPaneOpenChange,
    prepareCreationPane,
  ]);

  const openProjectCreationPane = useCallback(
    (entryMode: ProjectCreationPaneEntryMode = "general") => {
      if (entryMode === "templateDirect") {
        openProjectSideRoute({ entryMode, kind: "projectCreation" });
        return;
      }
      openProjectSideRoute({ entryMode, kind: "projectCreation" });
    },
    [openProjectSideRoute]
  );

  const projectListSidePaneSurface = useMemo<ProjectSidePaneAssistantSurface>(
    () => ({
      id: "project-list",
      openAssistantIntent: (intent) => {
        const entry = projectListEntryForAssistantIntent(intent);
        if (entry == null) {
          return { status: "ignored" as const };
        }
        openProjectSideRoute(entry);
        return { status: "handled" as const };
      },
    }),
    [openProjectSideRoute]
  );
  useProjectSidePaneSurface(projectListSidePaneSurface);

  const explorerActions = useMemo(
    () => ({ ...actions, onNewProject: openProjectCreationPane }),
    [actions, openProjectCreationPane]
  );
  const creationPaneOpen = creationSideEntry != null;
  const skillsPaneOpen = projectSideRouteEntry?.kind === "skillsWorkflow";
  const sidePaneOpen = creationPaneOpen || skillsPaneOpen;
  // The reserve snap + FLIP ride the side pane's enter beat: the pane's mount
  // commit and the layout snap land in separate frames, so the open hitch
  // doesn't stack into one long frame.
  const reserveOpen = useEnterMotionFrames(sidePaneOpen);
  const explorerFlipRef = useSidePaneReserveFlip(reserveOpen);

  const sidePaneContent = useMemo((): ReactNode => {
    if (creationPaneOpen) {
      return (
        <ProjectCreationPane
          busy={githubDeployerLoading}
          creatorRootProps={creatorRootProps}
          entryMode={creationPaneEntryMode}
          onActiveSourceChange={onCreationPaneSourceChange}
          onClose={() => closeProjectSideRoute()}
          resetKey={creatorResetKey}
        />
      );
    }
    if (skillsPaneOpen) {
      return (
        <SealosSkillsWorkflowPane onClose={() => closeProjectSideRoute()} />
      );
    }
    return null;
  }, [
    closeProjectSideRoute,
    creationPaneEntryMode,
    creationPaneOpen,
    creatorResetKey,
    creatorRootProps,
    githubDeployerLoading,
    onCreationPaneSourceChange,
    skillsPaneOpen,
  ]);

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden"
        data-slot="project-index-background"
      >
        <div
          className="absolute inset-0 z-0"
          style={{
            backgroundImage:
              "radial-gradient(circle, color-mix(in oklab, var(--color-zinc-600) 72%, transparent) 0.5px, transparent 0.5px)",
            backgroundPosition: "24px 0",
            backgroundSize: "32px 41px",
            maskImage:
              "linear-gradient(to bottom, black 0%, black 58%, transparent 94%)",
          }}
        />
        <ProjectIndexHorizon />
      </div>
      <div
        className={cn(
          styles.layout,
          "relative z-10 flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden"
        )}
      >
        <section className="@container/project-index-main flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div
            className="flex min-h-0 flex-1 flex-col items-center gap-4 px-[clamp(1rem,4cqw,3.25rem)] pt-13 pb-6"
            ref={explorerFlipRef}
          >
            <ProjectExplorer.Root actions={explorerActions} states={states}>
              <ProjectExplorer.Variant1
                className="w-full min-w-0 max-w-6xl flex-1"
                headerDescription="View existing projects or create a new one."
              />
            </ProjectExplorer.Root>
          </div>
        </section>
        <div
          aria-hidden
          className={cn(styles.sidePaneReserve, "min-h-0 shrink-0")}
          data-open={reserveOpen}
          data-slot="project-index-side-pane-reserve"
        />
      </div>

      <SidePanePresence>{sidePaneContent}</SidePanePresence>
    </div>
  );
}
