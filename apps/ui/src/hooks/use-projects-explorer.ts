"use client";

import { fetcher } from "@workspace/api/fetch";
import { useApsK8sList, useDbsK8sList } from "@workspace/api/hooks";
import { apItemsFromList } from "@workspace/api/lib/ap-list";
import type { K8sGetResponse } from "@workspace/api/schemas/k8s-get";
import type {
  ProjectExplorerActions,
  ProjectExplorerProject,
  ProjectExplorerStates,
} from "@workspace/ui/components/project-explorer/project-explorer";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { BRAIN_PROJECT_ID_LABEL } from "@/lib/brain-labels";
import {
  type BrainProjectResponse,
  type BrainProjectsResponse,
  brainProjectsToExplorerProjects,
  isProjectDisplayNameTaken,
} from "@/lib/brain-projects";
import {
  aggregateProjectStatuses,
  type ProjectWorkloadStatusInput,
} from "@/lib/project-aggregate-status";
import { openAssistantPane } from "@/store/layout-store";

/**
 * Extracts `{ projectId, phase, paused }` per workload from an AP or DB list
 * response. Items without a `brain.io/project-id` label are skipped
 * (they aren't tied to any Project row, so they cannot contribute).
 */
function projectWorkloadsFromList(
  data: K8sGetResponse | undefined
): ProjectWorkloadStatusInput[] {
  const items = apItemsFromList(data);
  const result: ProjectWorkloadStatusInput[] = [];
  for (const raw of items) {
    if (raw == null || typeof raw !== "object") {
      continue;
    }
    const item = raw as Record<string, unknown>;
    const meta = item.metadata as Record<string, unknown> | undefined;
    const labels = meta?.labels as Record<string, unknown> | undefined;
    const projectId = labels?.[BRAIN_PROJECT_ID_LABEL];
    if (typeof projectId !== "string" || projectId === "") {
      continue;
    }
    const status = item.status as Record<string, unknown> | undefined;
    const phaseRaw = status?.phase;
    const spec = item.spec as Record<string, unknown> | undefined;
    result.push({
      projectId,
      phase: typeof phaseRaw === "string" ? phaseRaw : undefined,
      paused: spec?.paused === true,
    });
  }
  return result;
}

export function useProjectsExplorer(options: {
  /** URL-encoded kubeconfig string (Bearer token body). */
  kubeconfig: string;
  /** Kubernetes namespace for list / patch / delete calls. */
  ns: string;
  /** When set, replaces the default “open assistant pane” handler for New Project. */
  onNewProject?: () => void;
}): {
  actions: ProjectExplorerActions;
  states: ProjectExplorerStates;
  /** Revalidate the projects list (e.g. after creating a project). */
  refreshProjects: () => Promise<unknown>;
} {
  const router = useRouter();
  const pathname = usePathname();
  const kubeconfig = options.kubeconfig.trim();
  const ns = options.ns;
  const onNewProjectOverride = options.onNewProject;
  const hasKubeconfig = kubeconfig !== "";

  const projectsQuery = useMemo(() => ({ namespace: ns }), [ns]);

  const { data: rawProjects, mutate } = useSWR(
    hasKubeconfig && ns !== ""
      ? (["/api/projects", projectsQuery] as const)
      : null,
    () =>
      fetcher<BrainProjectsResponse>({
        base: window.location.origin,
        path: "/api/projects",
        query: projectsQuery,
      })
  );

  // Project Aggregate Status fan-out. We list every AP/DB in the namespace
  // that carries a `brain.io/project-id` label and join in memory;
  // project names render as soon as the projects request resolves and dots
  // fill in when these arrive.
  const projectIdLabelExistence = BRAIN_PROJECT_ID_LABEL;
  const { data: apsData } = useApsK8sList({
    kubeconfig,
    labelSelector: projectIdLabelExistence,
    namespace: ns,
  });
  const { data: dbsData } = useDbsK8sList({
    kubeconfig,
    labelSelector: projectIdLabelExistence,
    namespace: ns,
  });

  const statusByProjectId = useMemo(() => {
    if (apsData === undefined && dbsData === undefined) {
      return undefined;
    }
    return aggregateProjectStatuses([
      ...projectWorkloadsFromList(apsData),
      ...projectWorkloadsFromList(dbsData),
    ]);
  }, [apsData, dbsData]);

  const projects = useMemo<ProjectExplorerProject[]>(
    () => brainProjectsToExplorerProjects(rawProjects, statusByProjectId),
    [rawProjects, statusByProjectId]
  );

  const states = useMemo(
    (): ProjectExplorerStates => ({
      projects,
    }),
    [projects]
  );

  const onProjectClick = useCallback(
    (p: ProjectExplorerProject) => {
      router.push(`/project/${encodeURIComponent(p.id)}`);
    },
    [router]
  );

  const onNewProject = useCallback(() => {
    if (onNewProjectOverride) {
      onNewProjectOverride();
      return;
    }
    openAssistantPane();
  }, [onNewProjectOverride]);

  const onProjectRename = useCallback(
    async (p: ProjectExplorerProject, newDisplayName: string) => {
      const displayName = newDisplayName.trim();
      if (!hasKubeconfig) {
        toast.error("Credentials are not ready yet.");
        throw new Error("not ready");
      }
      if (!displayName) {
        throw new Error("Project name is required.");
      }
      if (isProjectDisplayNameTaken(projects, displayName, p.id)) {
        throw new Error(`A project named "${displayName}" already exists.`);
      }
      try {
        const result = await fetcher<BrainProjectResponse>({
          base: window.location.origin,
          path: "/api/projects",
          method: "PATCH",
          body: {
            displayName,
            id: p.id,
            namespace: ns,
          },
        });
        await mutate();
        toast.success(`Project renamed to "${result.project.displayName}".`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Rename failed";
        toast.error(msg);
        throw e;
      }
    },
    [hasKubeconfig, mutate, ns, projects]
  );

  const onProjectDelete = useCallback(
    async (p: ProjectExplorerProject) => {
      if (!hasKubeconfig) {
        toast.error("Credentials are not ready yet.");
        throw new Error("not ready");
      }
      try {
        await fetcher({
          base: window.location.origin,
          path: "/api/projects",
          method: "DELETE",
          body: {
            id: p.id,
            namespace: ns,
          },
        });
        await mutate();
        toast.success(`Deleted "${p.name}".`);
        const uidEnc = encodeURIComponent(p.id);
        if (pathname === `/project/${uidEnc}`) {
          router.push("/project");
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Delete failed";
        toast.error(msg);
        throw e;
      }
    },
    [hasKubeconfig, mutate, ns, pathname, router]
  );

  const actions = useMemo(
    (): ProjectExplorerActions => ({
      onNewProject,
      onProjectClick,
      onProjectDelete,
      onProjectRename,
    }),
    [onNewProject, onProjectClick, onProjectDelete, onProjectRename]
  );

  return { actions, states, refreshProjects: mutate };
}
