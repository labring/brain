"use client";

import { kubeconfigCredentialKey } from "@workspace/api/credential-key";
import { fetcher } from "@workspace/api/fetch";
import { useCallback, useMemo } from "react";
import useSWR from "swr";

import { kubeconfigBearerHeader } from "@/lib/kubeconfig-header";
import {
  MAX_PINNED_PROJECTS,
  normalizePinnedProjectIds,
  pinnedProjectIdsEqual,
  prunePinnedProjectIds,
  type TogglePinnedProjectIdStatus,
  togglePinnedProjectId,
} from "@/lib/pinned-projects";

const PROJECT_NAVIGATION_PREFERENCES_API =
  "/api/project-navigation-preferences";
const EMPTY_PINNED_PROJECT_IDS: readonly string[] = Object.freeze([]);

interface ProjectNavigationPreferencesResponse {
  namespace: string;
  pinnedProjectIds: string[];
  updatedAt: string | null;
}

function preferencesResponse(
  namespace: string,
  pinnedProjectIds: readonly string[]
): ProjectNavigationPreferencesResponse {
  return {
    namespace,
    pinnedProjectIds: normalizePinnedProjectIds(pinnedProjectIds),
    updatedAt: null,
  };
}

export function usePinnedProjects(input: {
  kubeconfig: string;
  namespace: string;
}): {
  isPinnedProject: (projectId: string) => boolean;
  limit: number;
  pinnedProjectIds: readonly string[];
  prunePinnedProjects: (projectIds: readonly string[]) => Promise<void>;
  togglePinnedProject: (projectId: string) => Promise<{
    ids: string[];
    status: TogglePinnedProjectIdStatus;
  }>;
} {
  const namespace = input.namespace.trim();
  const kubeconfig = input.kubeconfig.trim();
  const enabled = namespace !== "" && kubeconfig !== "";
  const credentialKey = useMemo(
    () => kubeconfigCredentialKey(kubeconfig),
    [kubeconfig]
  );
  const swrKey = useMemo(
    () =>
      enabled
        ? ([
            PROJECT_NAVIGATION_PREFERENCES_API,
            namespace,
            credentialKey,
          ] as const)
        : null,
    [credentialKey, enabled, namespace]
  );
  const { data, mutate } = useSWR(
    swrKey,
    ([path, keyNamespace]) =>
      fetcher<ProjectNavigationPreferencesResponse>({
        base: window.location.origin,
        header: { Authorization: kubeconfigBearerHeader(kubeconfig) },
        path,
        query: { namespace: keyNamespace },
      }),
    { revalidateOnFocus: false, revalidateOnReconnect: false }
  );

  const pinnedProjectIds = useMemo(() => {
    const ids = normalizePinnedProjectIds(data?.pinnedProjectIds);
    return ids.length === 0 ? EMPTY_PINNED_PROJECT_IDS : Object.freeze(ids);
  }, [data?.pinnedProjectIds]);

  const persistPinnedProjectIds = useCallback(
    (ids: readonly string[]) =>
      fetcher<ProjectNavigationPreferencesResponse>({
        base: window.location.origin,
        body: { namespace, pinnedProjectIds: normalizePinnedProjectIds(ids) },
        header: { Authorization: kubeconfigBearerHeader(kubeconfig) },
        method: "PATCH",
        path: PROJECT_NAVIGATION_PREFERENCES_API,
      }),
    [kubeconfig, namespace]
  );

  const isPinnedProject = useCallback(
    (projectId: string) => pinnedProjectIds.includes(projectId),
    [pinnedProjectIds]
  );

  const togglePinnedProject = useCallback(
    async (projectId: string) => {
      const currentIds = normalizePinnedProjectIds(pinnedProjectIds);
      const result = togglePinnedProjectId(currentIds, projectId);
      if (!enabled || pinnedProjectIdsEqual(currentIds, result.ids)) {
        return result;
      }

      await mutate(() => persistPinnedProjectIds(result.ids), {
        optimisticData: preferencesResponse(namespace, result.ids),
        populateCache: true,
        revalidate: false,
        rollbackOnError: true,
      });
      return result;
    },
    [enabled, mutate, namespace, persistPinnedProjectIds, pinnedProjectIds]
  );

  const prunePinnedProjects = useCallback(
    async (projectIds: readonly string[]) => {
      const validProjectIds = new Set(projectIds);
      const currentIds = normalizePinnedProjectIds(pinnedProjectIds);
      const nextIds = prunePinnedProjectIds(currentIds, validProjectIds);
      if (!enabled || pinnedProjectIdsEqual(currentIds, nextIds)) {
        return;
      }

      await mutate(() => persistPinnedProjectIds(nextIds), {
        optimisticData: preferencesResponse(namespace, nextIds),
        populateCache: true,
        revalidate: false,
        rollbackOnError: true,
      });
    },
    [enabled, mutate, namespace, persistPinnedProjectIds, pinnedProjectIds]
  );

  return {
    isPinnedProject,
    limit: MAX_PINNED_PROJECTS,
    pinnedProjectIds,
    prunePinnedProjects,
    togglePinnedProject,
  };
}
