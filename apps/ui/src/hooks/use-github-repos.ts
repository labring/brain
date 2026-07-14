"use client";

import { useAtomValue } from "jotai";
import useSWR from "swr";
import type { GithubDeployerRepo } from "@/features/deployment/github-deployer/github-deployer.types";
import { desktopUserIdAtom, kubeconfigAtom } from "@/lib/auth-store";

interface GithubReposResponse {
  repos: GithubDeployerRepo[];
}

export function githubReposSWRKey(input: {
  kubeconfig: string;
  namespace: string;
  userId: string;
}) {
  const namespace = input.namespace.trim();
  const userId = input.userId.trim();
  return namespace !== "" && userId !== ""
    ? (["github-user-repos", namespace, userId, input.kubeconfig] as const)
    : null;
}

async function fetchRepos(
  namespace: string,
  kubeconfig: string,
  userId: string
): Promise<GithubDeployerRepo[]> {
  const url = new URL("/api/github/repos", window.location.origin);
  url.searchParams.set("namespace", namespace);
  url.searchParams.set("userId", userId);
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
  const userId = useAtomValue(desktopUserIdAtom).trim();
  const namespace = input.namespace?.trim() ?? "";
  const swrKey = input.isAuthorized
    ? githubReposSWRKey({ kubeconfig, namespace, userId })
    : null;

  const { data, error, isLoading, mutate } = useSWR(
    swrKey,
    () => fetchRepos(namespace, kubeconfig, userId),
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
