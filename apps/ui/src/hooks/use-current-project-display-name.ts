"use client";

import { fetcher } from "@workspace/api/fetch";
import { useMemo } from "react";
import useSWR from "swr";

import type { BrainProjectsResponse } from "@/lib/brain-projects";

export function useCurrentProjectDisplayName(options: {
  kubeconfig: string;
  namespace: string;
  projectUid: string;
}) {
  const kubeconfig = options.kubeconfig.trim();
  const namespace = options.namespace.trim();
  const projectUid = options.projectUid.trim();
  const enabled = kubeconfig !== "" && projectUid !== "";

  const projectsQuery = useMemo(() => ({ namespace }), [namespace]);

  const { data, error, isLoading } = useSWR(
    enabled && namespace !== ""
      ? (["/api/projects", projectsQuery] as const)
      : null,
    () =>
      fetcher<BrainProjectsResponse>({
        base: window.location.origin,
        path: "/api/projects",
        query: projectsQuery,
      })
  );

  const currentProject = useMemo(() => {
    const hit = (data?.projects ?? []).find(
      (project) => project.id === projectUid
    );
    if (hit == null) {
      return {
        displayName: undefined,
        resourceName: undefined,
      };
    }
    return {
      displayName: hit.displayName,
      resourceName: hit.id,
    };
  }, [data, projectUid]);

  return {
    displayName: currentProject.displayName,
    error: error instanceof Error ? error : undefined,
    isLoading: enabled && isLoading,
    resourceName: currentProject.resourceName,
  };
}
