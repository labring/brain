"use client";

import { ProjectExplorer } from "@workspace/ui/components/project-explorer/project-explorer";
import { SidePanePresence } from "@workspace/ui/components/side-pane";
import { cn } from "@workspace/ui/lib/utils";
import { useAtomValue } from "jotai";
import { useRouter } from "next/navigation";
import { useCallback, useMemo } from "react";

import { ProjectCreationPane } from "@/components/project-creation-pane";
import type { ProjectSidePaneSurface } from "@/features/project-surfaces/controller";
import { useProjectSidePaneSurface } from "@/features/project-surfaces/react";
import { projectListEntryForAssistantIntent } from "@/features/project-surfaces/surface-intents";
import { useProjectCreator } from "@/hooks/use-project-creator";
import { useProjectsExplorer } from "@/hooks/use-projects-explorer";
import { kubeconfigAtom, namespaceAtom } from "@/store/auth-store";

export default function ProjectIndexPage() {
  const router = useRouter();
  const kubeconfig = useAtomValue(kubeconfigAtom).trim();
  const ns = useAtomValue(namespaceAtom);

  const { actions, states, refreshProjects } = useProjectsExplorer({
    kubeconfig,
    ns,
  });

  const onProjectCreated = useCallback(
    async (projectUid: string | undefined) => {
      await refreshProjects();
      if (projectUid) {
        router.push(`/project/${encodeURIComponent(projectUid)}`);
      }
    },
    [refreshProjects, router]
  );

  const {
    creationPaneEntryMode,
    creationPaneOpen,
    creatorRootProps,
    creatorResetKey,
    githubDeployerLoading,
    onCreationPaneOpenChange,
    openCreationPane,
  } = useProjectCreator({
    existingProjects: states.projects,
    kubeconfig,
    namespace: ns,
    onProjectCreated,
  });

  const projectListSidePaneSurface = useMemo<ProjectSidePaneSurface>(
    () => ({
      id: "project-list",
      openAssistantIntent: (intent) => {
        const entry = projectListEntryForAssistantIntent(intent);
        if (entry?.kind !== "projectCreation") {
          return { status: "ignored" as const };
        }
        openCreationPane(entry.entryMode);
        return { status: "handled" as const };
      },
    }),
    [openCreationPane]
  );
  useProjectSidePaneSurface(projectListSidePaneSurface);

  const explorerActions = useMemo(
    () => ({ ...actions, onNewProject: openCreationPane }),
    [actions, openCreationPane]
  );

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
        <div
          className="absolute inset-0 z-10"
          style={{
            backgroundImage:
              "radial-gradient(ellipse 60% 40% at 50% 100%, color-mix(in oklab, var(--color-blue-500) 22%, transparent), transparent 70%)",
          }}
        />
      </div>
      <div
        className={cn(
          "relative flex min-h-0 flex-1 flex-col items-center gap-4 px-[52px] pt-[52px] pb-6 transition-[padding] duration-200 ease-out motion-reduce:transition-none",
          creationPaneOpen && "xl:pr-[40rem]"
        )}
      >
        <ProjectExplorer.Root actions={explorerActions} states={states}>
          <ProjectExplorer.Variant1
            className="w-full min-w-0 max-w-6xl flex-1"
            headerDescription="View existing projects or create a new one."
          />
        </ProjectExplorer.Root>
      </div>

      <SidePanePresence>
        {creationPaneOpen ? (
          <ProjectCreationPane
            busy={githubDeployerLoading}
            creatorRootProps={creatorRootProps}
            entryMode={creationPaneEntryMode}
            onClose={() => onCreationPaneOpenChange(false)}
            resetKey={creatorResetKey}
          />
        ) : null}
      </SidePanePresence>
    </div>
  );
}
