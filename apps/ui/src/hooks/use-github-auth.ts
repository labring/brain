"use client";

import { useAtomValue } from "jotai";
import { useCallback } from "react";
import useSWR from "swr";

import {
  GITHUB_OAUTH_CALLBACK_PATH,
  GITHUB_OAUTH_COMPLETE_MESSAGE,
  parseOAuthNamespaceParam,
  parseOAuthReturnPathParam,
} from "@/lib/github-oauth/types";
import { namespaceAtom } from "@/store/auth-store";

const OAUTH_POPUP_NAME = "brain-github-oauth";
const OAUTH_POPUP_FEATURES = [
  "popup=yes",
  "width=520",
  "height=720",
  "resizable=yes",
  "scrollbars=yes",
  "noopener=no",
  "noreferrer=no",
].join(",");

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

function centeredPopupFeatures(): string {
  const width = 520;
  const height = 720;
  const left = Math.max(
    0,
    Math.round(window.screenX + (window.outerWidth - width) / 2)
  );
  const top = Math.max(
    0,
    Math.round(window.screenY + (window.outerHeight - height) / 2)
  );
  return `${OAUTH_POPUP_FEATURES},left=${left},top=${top}`;
}

function sameOriginPath(raw: unknown): string | null {
  return typeof raw === "string" ? parseOAuthReturnPathParam(raw) : null;
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
    const popup = window.open(
      `${url.pathname}${url.search}`,
      OAUTH_POPUP_NAME,
      centeredPopupFeatures()
    );
    if (!popup) {
      window.location.assign(`${url.pathname}${url.search}`);
      return;
    }
    popup.focus();

    let closePoll: number | undefined;
    const cleanup = () => {
      window.removeEventListener("message", handleMessage);
      if (closePoll !== undefined) {
        window.clearInterval(closePoll);
      }
    };
    const refreshConnection = () => {
      mutate().catch(() => undefined);
    };
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) {
        return;
      }
      if (
        typeof event.data !== "object" ||
        event.data == null ||
        event.data.type !== GITHUB_OAUTH_COMPLETE_MESSAGE
      ) {
        return;
      }
      cleanup();
      const returnPath = sameOriginPath(event.data.returnPath);
      if (
        returnPath &&
        returnPath !== `${window.location.pathname}${window.location.search}`
      ) {
        window.history.replaceState(null, "", returnPath);
      }
      refreshConnection();
    };

    window.addEventListener("message", handleMessage);
    closePoll = window.setInterval(() => {
      if (popup.closed) {
        cleanup();
        refreshConnection();
      }
    }, 1000);
  }, [mutate, namespace]);

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
