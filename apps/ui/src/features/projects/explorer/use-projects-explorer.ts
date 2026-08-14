"use client";

import { kubeconfigCredentialKey } from "@workspace/api/credential-key";
import { fetcher } from "@workspace/api/fetch";
import { useApsK8sList, useDbsK8sList } from "@workspace/api/hooks";
import { apItemsFromList } from "@workspace/api/lib/ap-list";
import type { K8sGetResponse } from "@workspace/api/schemas/k8s-get";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { trackBrainGtmEventAfterSuccess } from "@/features/analytics/brain-gtm";
import { openAssistantPane } from "@/features/panes/layout-store";
import {
  type BrainProjectResponse,
  type BrainProjectsResponse,
  brainProjectsToExplorerProjects,
  isProjectDisplayNameTaken,
} from "@/features/projects/brain-projects";
import { useDemoProjectsMock } from "@/features/projects/demo/use-demo-projects-mock";
import type {
  ProjectDeleteReason,
  ProjectExplorerActions,
  ProjectExplorerProject,
  ProjectExplorerStates,
} from "@/features/projects/explorer/project-explorer";
import {
  aggregateProjectStatuses,
  type ProjectWorkloadStatusInput,
} from "@/features/projects/project-aggregate-status";
import { projectShortcutIconKeysFromWorkloads } from "@/features/projects/project-shortcut-icons";
import { usePinnedProjects } from "@/features/projects/use-pinned-projects";
import { useProjectShortcutIconPreload } from "@/features/projects/use-project-shortcut-icon-preload";
import { BRAIN_PROJECT_ID_LABEL } from "@/lib/brain-labels";
import { kubeconfigBearerHeader } from "@/lib/kubeconfig-header";
import { errorDescription, toastErrorDetail } from "@/lib/toast-utils";

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
    let phase: string | undefined;
    if (typeof phaseRaw === "string") {
      phase = phaseRaw;
    }
    result.push({
      projectId,
      phase,
      paused: spec?.paused === true,
    });
  }
  return result;
}

export function projectHistoryErrorEmptyState(error: unknown):
  | {
      description: string;
      title: string;
    }
  | undefined {
  if (error == null) {
    return undefined;
  }

  const message = error instanceof Error ? error.message : "";
  if (message.startsWith("API 401:")) {
    return {
      description:
        "Project history is waiting for workspace credentials. Open Brain inside Sealos Desktop or configure NEXT_PUBLIC_DEV_ENCODED_KUBECONFIG for local development.",
      title: "Workspace credentials unavailable",
    };
  }
  if (message.startsWith("API 403:")) {
    return {
      description:
        "Project history is unavailable because the current workspace credentials are not authorized for this namespace.",
      title: "Workspace access denied",
    };
  }
  return {
    description:
      "Project history is temporarily unavailable because the app database cannot be reached. Check DATABASE_URL and database status, then refresh.",
    title: "System configuration unavailable",
  };
}

interface ProjectsExplorerReadModelOptions {
  /** URL-encoded kubeconfig string (Bearer token body). */
  kubeconfig: string;
  /** Kubernetes namespace for list / patch / delete calls. */
  ns: string;
}

interface ProjectsExplorerOptions extends ProjectsExplorerReadModelOptions {
  /** When set, replaces the default “open assistant pane” handler for New Project. */
  onNewProject?: () => void;
}

interface ProjectsExplorerReadModel {
  data: {
    aps: K8sGetResponse | undefined;
    dbs: K8sGetResponse | undefined;
  };
  /** True while the demo mock replaces remote data (dev tweaks "Mock data"). */
  demoActive: boolean;
  /** Revalidate the projects list (e.g. after creating a project). */
  refreshProjects: () => Promise<unknown>;
  states: ProjectExplorerStates;
}

interface ProjectsExplorerResult extends ProjectsExplorerReadModel {
  actions: ProjectExplorerActions;
}

function useProjectsExplorerModel(options: ProjectsExplorerReadModelOptions) {
  // While the demo mock is on it replaces every remote read with the
  // generated dataset. Real credentials may exist (the desktop iframe injects
  // them), so the mock must win explicitly: blanking kubeconfig/ns keeps
  // every SWR key below null and no request ever fires.
  const demo = useDemoProjectsMock();
  const kubeconfig = demo === null ? options.kubeconfig.trim() : "";
  const ns = demo === null ? options.ns : "";
  const hasKubeconfig = demo !== null || kubeconfig !== "";
  const credentialKey = useMemo(
    () => kubeconfigCredentialKey(kubeconfig),
    [kubeconfig]
  );
  const {
    limit: pinnedProjectLimit,
    pinnedProjectIds: remotePinnedProjectIds,
    prunePinnedProjects,
    togglePinnedProject: toggleRemotePinnedProject,
  } = usePinnedProjects({ kubeconfig, namespace: ns });
  const pinnedProjectIds =
    demo === null ? remotePinnedProjectIds : demo.pinnedProjectIds;
  const togglePinnedProject =
    demo === null ? toggleRemotePinnedProject : demo.togglePinnedProject;

  const projectsQuery = useMemo(() => ({ namespace: ns }), [ns]);

  const {
    data: rawProjects,
    error: projectsError,
    mutate,
  } = useSWR(
    hasKubeconfig && ns !== ""
      ? (["/api/projects", projectsQuery, credentialKey] as const)
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

  const remoteProjectShortcutIconKeys = useMemo(
    () =>
      projectShortcutIconKeysFromWorkloads({
        aps: apsData,
        dbs: dbsData,
      }),
    [apsData, dbsData]
  );
  const projectShortcutIconKeys =
    demo === null
      ? remoteProjectShortcutIconKeys
      : demo.projectShortcutIconKeys;
  useProjectShortcutIconPreload(projectShortcutIconKeys);

  const projects = useMemo<ProjectExplorerProject[]>(
    () =>
      demo === null
        ? brainProjectsToExplorerProjects(rawProjects, statusByProjectId)
        : demo.projects,
    [demo, rawProjects, statusByProjectId]
  );

  useEffect(() => {
    if (rawProjects === undefined) {
      return;
    }
    prunePinnedProjects(projects.map((project) => project.id)).catch(
      () => undefined
    );
  }, [projects, prunePinnedProjects, rawProjects]);

  const projectHistoryEmptyState = useMemo(
    () => projectHistoryErrorEmptyState(projectsError),
    [projectsError]
  );

  const states = useMemo(
    (): ProjectExplorerStates => ({
      ...(projectHistoryEmptyState ? { empty: projectHistoryEmptyState } : {}),
      pinnedProjectIds,
      pinnedProjectLimit,
      projectShortcutIconKeys,
      projects,
    }),
    [
      pinnedProjectIds,
      pinnedProjectLimit,
      projectHistoryEmptyState,
      projectShortcutIconKeys,
      projects,
    ]
  );

  const data = useMemo(
    () => ({
      aps: apsData,
      dbs: dbsData,
    }),
    [apsData, dbsData]
  );

  return {
    data,
    demoActive: demo !== null,
    hasKubeconfig,
    kubeconfig,
    mutate,
    ns,
    pinnedProjectLimit,
    projects,
    states,
    togglePinnedProject,
  };
}

export function useProjectsExplorerReadModel(
  options: ProjectsExplorerReadModelOptions
): ProjectsExplorerReadModel {
  const { data, demoActive, mutate, states } =
    useProjectsExplorerModel(options);
  return useMemo(
    () => ({ data, demoActive, refreshProjects: mutate, states }),
    [data, demoActive, mutate, states]
  );
}

export function useProjectsExplorer(
  options: ProjectsExplorerOptions
): ProjectsExplorerResult {
  const router = useRouter();
  const onNewProjectOverride = options.onNewProject;
  const {
    data,
    demoActive,
    hasKubeconfig,
    kubeconfig,
    mutate,
    ns,
    pinnedProjectLimit,
    projects,
    states,
    togglePinnedProject,
  } = useProjectsExplorerModel(options);

  const onProjectClick = useCallback(
    (p: ProjectExplorerProject) => {
      router.push(`/project/${encodeURIComponent(p.id)}`);
    },
    [router]
  );

  const onNewProject = useCallback(() => {
    if (demoActive) {
      toast.info("Demo mode — project creation is disabled.");
      return;
    }
    if (onNewProjectOverride) {
      onNewProjectOverride();
      return;
    }
    openAssistantPane();
  }, [demoActive, onNewProjectOverride]);

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
        toastErrorDetail(
          "Project update failed.",
          errorDescription(e, "Project update failed.")
        );
        throw e;
      }
    },
    [hasKubeconfig, kubeconfig, mutate, ns, projects]
  );

  const onProjectDelete = useCallback(
    async (p: ProjectExplorerProject, reason: ProjectDeleteReason) => {
      if (!hasKubeconfig) {
        toast.error("Credentials are not ready yet.");
        throw new Error("not ready");
      }
      try {
        await trackBrainGtmEventAfterSuccess(
          () =>
            fetcher({
              base: window.location.origin,
              path: "/api/projects",
              method: "DELETE",
              header: { Authorization: kubeconfigBearerHeader(kubeconfig) },
              body: {
                id: p.id,
                namespace: ns,
              },
            }),
          {
            app_name: p.name,
            event: "deployment_delete",
            project_id: p.id,
            reason,
          }
        );
        await mutate();
        toast.success(`Deleted "${p.name}".`);
        const uidEnc = encodeURIComponent(p.id);
        if (window.location.pathname === `/project/${uidEnc}`) {
          router.push("/project");
        }
      } catch (e) {
        toastErrorDetail(
          "Project delete failed.",
          errorDescription(e, "Project delete failed.")
        );
        throw e;
      }
    },
    [hasKubeconfig, kubeconfig, mutate, ns, router]
  );

  const onProjectPinToggle = useCallback(
    async (p: ProjectExplorerProject) => {
      if (!hasKubeconfig) {
        toast.error("Credentials are not ready yet.");
        return;
      }

      try {
        const result = await togglePinnedProject(p.id);
        if (result.status === "added") {
          toast.success(`Pinned "${p.name}".`);
        } else if (result.status === "removed") {
          toast.success(`Unpinned "${p.name}".`);
        } else if (result.status === "limit-reached") {
          toast.error(`You can pin up to ${pinnedProjectLimit} projects.`);
        }
      } catch {
        toast.error("Project shortcuts could not be updated.");
      }
    },
    [hasKubeconfig, pinnedProjectLimit, togglePinnedProject]
  );

  const actions = useMemo((): ProjectExplorerActions => {
    // The demo mock keeps pinning as the only row interaction: mock project
    // ids have no real page or backend record, and the list hides the
    // affordances whose handlers are absent (open, edit, delete).
    if (demoActive) {
      return { onNewProject, onProjectPinToggle };
    }
    return {
      onNewProject,
      onProjectClick,
      onProjectDelete,
      onProjectPinToggle,
      onProjectUpdate,
    };
  }, [
    demoActive,
    onNewProject,
    onProjectClick,
    onProjectDelete,
    onProjectPinToggle,
    onProjectUpdate,
  ]);

  return { actions, data, demoActive, states, refreshProjects: mutate };
}
