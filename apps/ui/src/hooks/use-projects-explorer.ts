"use client";

import { fetcher } from "@workspace/api/fetch";
import { useApsK8sList, useDbsK8sList } from "@workspace/api/hooks";
import { apItemsFromList } from "@workspace/api/lib/ap-list";
import type { K8sGetResponse } from "@workspace/api/schemas/k8s-get";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { useTemplateNativeWorkloads } from "@/features/project-canvas/snapshot/use-template-native-workloads";
import type {
  ProjectExplorerActions,
  ProjectExplorerProject,
  ProjectExplorerStates,
} from "@/features/projects/explorer/project-explorer";
import {
  BRAIN_DEPLOYMENT_KIND_LABEL,
  BRAIN_PROJECT_ID_LABEL,
} from "@/lib/brain-labels";
import {
  type BrainProjectResponse,
  type BrainProjectsResponse,
  brainProjectsToExplorerProjects,
  isProjectDisplayNameTaken,
} from "@/lib/brain-projects";
import { kubeconfigBearerHeader } from "@/lib/kubeconfig-header";
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
  data: K8sGetResponse | undefined,
  options?: { inferNativePhase?: boolean }
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
    let phase: string | undefined;
    if (typeof phaseRaw === "string") {
      phase = phaseRaw;
    } else if (options?.inferNativePhase === true) {
      phase = nativeWorkloadPhase(status);
    }
    result.push({
      projectId,
      phase,
      paused: spec?.paused === true,
    });
  }
  return result;
}

function nativeWorkloadPhase(status: Record<string, unknown> | undefined) {
  const phaseRaw = status?.phase;
  if (typeof phaseRaw === "string") {
    return phaseRaw;
  }
  const replicas = status?.replicas;
  const readyReplicas = status?.readyReplicas;
  if (
    typeof replicas === "number" &&
    replicas > 0 &&
    typeof readyReplicas === "number" &&
    readyReplicas >= replicas
  ) {
    return "Running";
  }
  return "Creating";
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
  data: {
    aps: K8sGetResponse | undefined;
    dbs: K8sGetResponse | undefined;
  };
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

  const {
    data: rawProjects,
    error: projectsError,
    mutate,
  } = useSWR(
    hasKubeconfig && ns !== ""
      ? (["/api/projects", projectsQuery, kubeconfig] as const)
      : null,
    () =>
      fetcher<BrainProjectsResponse>({
        base: window.location.origin,
        header: { Authorization: kubeconfigBearerHeader(kubeconfig) },
        path: "/api/projects",
        query: projectsQuery,
      }),
    { revalidateOnFocus: false, revalidateOnReconnect: false }
  );

  // Project Aggregate Status fan-out. We list every AP/DB in the namespace
  // that carries a `brain.io/project-id` label and join in memory;
  // project names render as soon as the projects request resolves and dots
  // fill in when these arrive.
  const projectIdLabelExistence = BRAIN_PROJECT_ID_LABEL;
  const templateNativeLabelSelector = `${projectIdLabelExistence},${BRAIN_DEPLOYMENT_KIND_LABEL}=template`;
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
  const { data: templateNativeData } = useTemplateNativeWorkloads({
    kubeconfig,
    labelSelector: templateNativeLabelSelector,
    namespace: ns,
  });

  const statusByProjectId = useMemo(() => {
    if (
      apsData === undefined &&
      dbsData === undefined &&
      templateNativeData.deployments === undefined &&
      templateNativeData.statefulSets === undefined
    ) {
      return undefined;
    }
    return aggregateProjectStatuses([
      ...projectWorkloadsFromList(apsData),
      ...projectWorkloadsFromList(dbsData),
      ...projectWorkloadsFromList(templateNativeData.deployments, {
        inferNativePhase: true,
      }),
      ...projectWorkloadsFromList(templateNativeData.statefulSets, {
        inferNativePhase: true,
      }),
    ]);
  }, [apsData, dbsData, templateNativeData]);

  const projects = useMemo<ProjectExplorerProject[]>(
    () => brainProjectsToExplorerProjects(rawProjects, statusByProjectId),
    [rawProjects, statusByProjectId]
  );

  const states = useMemo(
    (): ProjectExplorerStates => ({
      ...(projectsError
        ? {
            empty: {
              description:
                "Project history is temporarily unavailable because the app database cannot be reached. Check DATABASE_URL and database status, then refresh.",
              title: "System configuration unavailable",
            },
          }
        : {}),
      projects,
    }),
    [projects, projectsError]
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

  const onProjectUpdate = useCallback(
    async (
      p: ProjectExplorerProject,
      next: { description: string; displayName: string }
    ) => {
      const displayName = next.displayName.trim();
      const description = next.description.trim();
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
          header: { Authorization: kubeconfigBearerHeader(kubeconfig) },
          body: {
            description,
            displayName,
            id: p.id,
            namespace: ns,
          },
        });
        await mutate();
        toast.success(`Updated "${result.project.displayName}".`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Project update failed";
        toast.error(msg);
        throw e;
      }
    },
    [hasKubeconfig, kubeconfig, mutate, ns, projects]
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
          header: { Authorization: kubeconfigBearerHeader(kubeconfig) },
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
    [hasKubeconfig, kubeconfig, mutate, ns, pathname, router]
  );

  const actions = useMemo(
    (): ProjectExplorerActions => ({
      onNewProject,
      onProjectClick,
      onProjectDelete,
      onProjectUpdate,
    }),
    [onNewProject, onProjectClick, onProjectDelete, onProjectUpdate]
  );

  const data = useMemo(
    () => ({
      aps: apsData,
      dbs: dbsData,
    }),
    [apsData, dbsData]
  );

  return { actions, data, states, refreshProjects: mutate };
}
