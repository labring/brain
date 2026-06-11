"use client";

import { useAtomValue } from "jotai";
import { useCallback } from "react";
import useSWR from "swr";

import {
  GITHUB_OAUTH_CALLBACK_PATH,
  parseOAuthNamespaceParam,
} from "@/lib/github-oauth/types";
import { namespaceAtom } from "@/store/auth-store";

interface GithubConnectionResponse {
  connection: {
    githubLogin: string;
    isAuthorized: boolean;
    namespace: string;
    scope: string;
    updatedAt: string;
  } | null;
}

export interface UseGithubAuthResult {
  canCheck: boolean;
  disconnectGithubAuth: () => Promise<void>;
  error: Error | undefined;
  githubLogin: string | undefined;
  initiateGithubAuth: () => void;
  isAuthorized: boolean;
  isLoading: boolean;
  mutate: () => Promise<unknown>;
}

async function fetchConnection(
  namespace: string
): Promise<GithubConnectionResponse> {
  const url = new URL("/api/github/connection", window.location.origin);
  url.searchParams.set("namespace", namespace);
  const response = await fetch(url.toString(), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return (await response.json()) as GithubConnectionResponse;
}

async function deleteConnection(namespace: string): Promise<void> {
  const url = new URL("/api/github/connection", window.location.origin);
  url.searchParams.set("namespace", namespace);
  const response = await fetch(url.toString(), {
    cache: "no-store",
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
}

export function useGithubAuth(options?: {
  enabled?: boolean;
}): UseGithubAuthResult {
  const enabled = options?.enabled ?? true;
  const namespace = useAtomValue(namespaceAtom).trim();
  const canCheck = enabled && namespace !== "";
  const swrKey = canCheck ? (["github-connection", namespace] as const) : null;

  const { data, error, isLoading, mutate } = useSWR(
    swrKey,
    () => fetchConnection(namespace),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      shouldRetryOnError: false,
    }
  );

  let err: Error | undefined;
  if (error instanceof Error) {
    err = error;
  } else if (error != null) {
    err = new Error(String(error));
  }

  const initiateGithubAuth = useCallback(() => {
    const next = `${window.location.pathname}${window.location.search}`;
    const url = new URL(GITHUB_OAUTH_CALLBACK_PATH, window.location.origin);
    url.searchParams.set("next", next);
    const normalizedNamespace = parseOAuthNamespaceParam(namespace);
    if (normalizedNamespace) {
      url.searchParams.set("namespace", normalizedNamespace);
    }
    window.location.assign(`${url.pathname}${url.search}`);
  }, [namespace]);

  const disconnectGithubAuth = useCallback(async () => {
    if (!canCheck) {
      return;
    }
    await deleteConnection(namespace);
    await mutate({ connection: null }, { revalidate: false });
  }, [canCheck, mutate, namespace]);

  return {
    canCheck,
    disconnectGithubAuth,
    error: err,
    githubLogin: data?.connection?.githubLogin,
    initiateGithubAuth,
    isAuthorized: data?.connection?.isAuthorized ?? false,
    isLoading: canCheck ? isLoading : false,
    mutate,
  };
}
