"use client";

import { useAtomValue } from "jotai";
import useSWR from "swr";
import type { GithubDeployerRepo } from "@/features/deploy/github-deployer/github-deployer.types";
import { appTokenAtom, kubeconfigAtom } from "@/lib/auth-store";
import { personalResourceAuthHeaders } from "@/lib/personal-resource-headers";

interface GithubReposResponse {
  repos: GithubDeployerRepo[];
}

export function githubReposSWRKey(input: {
  appToken: string;
  kubeconfig: string;
  namespace: string;
}) {
  const namespace = input.namespace.trim();
  const kubeconfig = input.kubeconfig.trim();
  return namespace !== "" && kubeconfig !== ""
    ? ([
        "github-user-repos",
        namespace,
        input.kubeconfig,
        input.appToken,
      ] as const)
    : null;
}

async function fetchRepos(credentials: {
  appToken: string;
  kubeconfig: string;
  namespace: string;
}): Promise<GithubDeployerRepo[]> {
  const url = new URL("/api/github/repos", window.location.origin);
  url.searchParams.set("namespace", credentials.namespace);
  const response = await fetch(url.toString(), {
    cache: "no-store",
    headers:
      credentials.kubeconfig.trim() === ""
        ? undefined
        : personalResourceAuthHeaders(credentials),
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
  const appToken = useAtomValue(appTokenAtom);
  const kubeconfig = useAtomValue(kubeconfigAtom);
  const namespace = input.namespace?.trim() ?? "";
  const swrKey = input.isAuthorized
    ? githubReposSWRKey({ appToken, kubeconfig, namespace })
    : null;

  const { data, error, isLoading, mutate } = useSWR(
    swrKey,
    () => fetchRepos({ appToken, kubeconfig, namespace }),
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
