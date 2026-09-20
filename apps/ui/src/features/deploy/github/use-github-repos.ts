"use client";

import useSWR from "swr";
import type { GithubDeployerRepo } from "@/features/deploy/github-deployer/github-deployer.types";
import {
  SESSION_SWR_KEYS,
  type SessionCredentials,
} from "@/features/session/swr-keys";
import { useSessionCredentials } from "@/features/session/use-session-credentials";
import { personalResourceAuthHeaders } from "@/lib/personal-resource-headers";

interface GithubReposResponse {
  repos: GithubDeployerRepo[];
}

export function githubReposSWRKey(input: SessionCredentials) {
  const namespace = input.namespace.trim();
  const kubeconfig = input.kubeconfig.trim();
  return namespace !== "" && kubeconfig !== ""
    ? SESSION_SWR_KEYS.githubUserRepos(input)
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
  const session = useSessionCredentials();
  const { appToken, kubeconfig } = session;
  const namespace = input.namespace?.trim() ?? "";
  const swrKey = input.isAuthorized
    ? githubReposSWRKey({ ...session, namespace })
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
