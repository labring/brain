"use client";

import { useAtomValue } from "jotai";
import useSWR from "swr";
import type { GithubDeployerRepo } from "@/features/deploy/github-deployer/github-deployer.types";
import { kubeconfigAtom } from "@/lib/auth-store";

interface GithubReposResponse {
  repos: GithubDeployerRepo[];
}

export function githubReposSWRKey(input: {
  kubeconfig: string;
  namespace: string;
}) {
  const namespace = input.namespace.trim();
  const kubeconfig = input.kubeconfig.trim();
  return namespace !== "" && kubeconfig !== ""
    ? (["github-user-repos", namespace, input.kubeconfig] as const)
    : null;
}

async function fetchRepos(
  namespace: string,
  kubeconfig: string
): Promise<GithubDeployerRepo[]> {
  const url = new URL("/api/github/repos", window.location.origin);
  url.searchParams.set("namespace", namespace);
  const response = await fetch(url.toString(), {
    cache: "no-store",
    headers:
      kubeconfig.trim() === ""
        ? undefined
        : { Authorization: `Bearer ${encodeURIComponent(kubeconfig)}` },
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  const body = (await response.json()) as GithubReposResponse;
  return Array.isArray(body.repos) ? body.repos : [];
}

export function useGithubRepos(input: {
  isAuthorized: boolean;
  namespace: string | undefined;
}) {
  const kubeconfig = useAtomValue(kubeconfigAtom);
  const namespace = input.namespace?.trim() ?? "";
  const swrKey = input.isAuthorized
    ? githubReposSWRKey({ kubeconfig, namespace })
    : null;

  const { data, error, isLoading, mutate } = useSWR(
    swrKey,
    () => fetchRepos(namespace, kubeconfig),
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );

  let errOut: Error | undefined;
  if (error != null) {
    errOut = error instanceof Error ? error : new Error(String(error));
  }

  return {
    error: errOut,
    isLoading: swrKey !== null && isLoading,
    mutate,
    repos: data ?? [],
  };
}
