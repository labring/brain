"use client";

import useSWR from "swr";
import type { GithubDeployerRepo } from "@/features/deployment/github-deployer/github-deployer.types";

interface GithubReposResponse {
  repos: GithubDeployerRepo[];
}

async function fetchRepos(namespace: string): Promise<GithubDeployerRepo[]> {
  const url = new URL("/api/github/repos", window.location.origin);
  url.searchParams.set("namespace", namespace);
  const response = await fetch(url.toString(), { cache: "no-store" });
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
  const namespace = input.namespace?.trim() ?? "";
  const swrKey =
    input.isAuthorized && namespace !== ""
      ? (["github-user-repos", namespace] as const)
      : null;

  const { data, error, isLoading, mutate } = useSWR(
    swrKey,
    () => fetchRepos(namespace),
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
