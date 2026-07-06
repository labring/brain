"use client";

import { useAtomValue } from "jotai";
import { useCallback } from "react";
import useSWR, { useSWRConfig } from "swr";

import { githubReposSWRKey } from "@/hooks/use-github-repos";
import {
  GITHUB_APP_INSTALL_COMPLETE_MESSAGE,
  parseInstallNamespaceParam,
  parseInstallReturnPathParam,
} from "@/lib/github-app/types";
import {
  desktopUserIdAtom,
  kubeconfigAtom,
  namespaceAtom,
} from "@/store/auth-store";

const GITHUB_APP_INSTALL_POPUP_NAME = "brain-github-app-install";
const GITHUB_APP_INSTALL_POPUP_FEATURES = [
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
    accountLogin: string;
    accountType: string;
    id: string;
    installationId: string;
    isAuthorized: boolean;
    namespace: string;
    repositorySelection: string;
    updatedAt: string;
  } | null;
}

export interface UseGithubAuthResult {
  canCheck: boolean;
  disconnectGithubAuth: () => Promise<void>;
  error: Error | undefined;
  githubConnectionId: string | undefined;
  githubLogin: string | undefined;
  initiateGithubAuth: () => void;
  isAuthorized: boolean;
  isLoading: boolean;
  mutate: () => Promise<unknown>;
}

async function fetchConnection(
  namespace: string,
  kubeconfig: string,
  userId: string
): Promise<GithubConnectionResponse> {
  const url = new URL("/api/github/connection", window.location.origin);
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
  return (await response.json()) as GithubConnectionResponse;
}

async function deleteConnection(
  namespace: string,
  kubeconfig: string,
  userId: string
): Promise<void> {
  const url = new URL("/api/github/connection", window.location.origin);
  url.searchParams.set("namespace", namespace);
  url.searchParams.set("userId", userId);
  const response = await fetch(url.toString(), {
    cache: "no-store",
    headers:
      kubeconfig.trim() === ""
        ? undefined
        : { Authorization: `Bearer ${encodeURIComponent(kubeconfig)}` },
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
}

async function createInstallSession(
  namespace: string,
  kubeconfig: string,
  userId: string,
  returnPath: string
): Promise<{ installUrl: string }> {
  const response = await fetch("/api/github/install-session", {
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    method: "POST",
    body: JSON.stringify({
      encodedKubeconfig: encodeURIComponent(kubeconfig),
      namespace,
      returnPath,
      userId,
    }),
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  const body = (await response.json()) as { installUrl?: unknown };
  if (typeof body.installUrl !== "string" || body.installUrl.trim() === "") {
    throw new Error("GitHub App install URL was not returned.");
  }
  return { installUrl: body.installUrl };
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
  return `${GITHUB_APP_INSTALL_POPUP_FEATURES},left=${left},top=${top}`;
}

function sameOriginPath(raw: unknown): string | null {
  return typeof raw === "string" ? parseInstallReturnPathParam(raw) : null;
}

export function useGithubAuth(options?: {
  enabled?: boolean;
}): UseGithubAuthResult {
  const enabled = options?.enabled ?? true;
  const kubeconfig = useAtomValue(kubeconfigAtom);
  const namespace = useAtomValue(namespaceAtom).trim();
  const userId = useAtomValue(desktopUserIdAtom).trim();
  const canCheck = enabled && namespace !== "" && userId !== "";
  const { mutate: mutateCache } = useSWRConfig();
  const swrKey = canCheck
    ? (["github-connection", namespace, userId] as const)
    : null;

  const { data, error, isLoading, mutate } = useSWR(
    swrKey,
    () => fetchConnection(namespace, kubeconfig, userId),
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
    const normalizedNamespace = parseInstallNamespaceParam(namespace);
    const openPopup = () => {
      const popup = window.open(
        "about:blank",
        GITHUB_APP_INSTALL_POPUP_NAME,
        centeredPopupFeatures()
      );
      if (!popup) {
        return null;
      }
      popup.focus();
      return popup;
    };

    let closePoll: number | undefined;
    const cleanup = () => {
      window.removeEventListener("message", handleMessage);
      if (closePoll !== undefined) {
        window.clearInterval(closePoll);
      }
    };
    const refreshConnection = () => {
      mutate().catch(() => undefined);
      const reposKey = githubReposSWRKey({ kubeconfig, namespace, userId });
      if (reposKey != null) {
        mutateCache(reposKey).catch(() => undefined);
      }
    };
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) {
        return;
      }
      if (
        typeof event.data !== "object" ||
        event.data == null ||
        event.data.type !== GITHUB_APP_INSTALL_COMPLETE_MESSAGE
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

    const start = async (popup: Window | null) => {
      if (
        kubeconfig.trim() === "" ||
        normalizedNamespace == null ||
        userId === ""
      ) {
        throw new Error(
          "GitHub App installation requires workspace credentials and user ID."
        );
      }
      const { installUrl } = await createInstallSession(
        normalizedNamespace,
        kubeconfig,
        userId,
        next
      );
      if (popup == null) {
        window.location.assign(installUrl);
        return;
      }
      popup.location.replace(installUrl);
      window.addEventListener("message", handleMessage);
      closePoll = window.setInterval(() => {
        if (popup.closed) {
          cleanup();
          refreshConnection();
        }
      }, 1000);
    };

    const popup = openPopup();
    start(popup).catch((startError: unknown) => {
      popup?.close();
      console.error(
        "[github-app] failed to create install session:",
        startError
      );
    });
  }, [kubeconfig, mutate, mutateCache, namespace, userId]);

  const disconnectGithubAuth = useCallback(async () => {
    if (!canCheck) {
      return;
    }
    await deleteConnection(namespace, kubeconfig, userId);
    await mutate({ connection: null }, { revalidate: false });
  }, [canCheck, kubeconfig, mutate, namespace, userId]);

  return {
    canCheck,
    disconnectGithubAuth,
    error: err,
    githubConnectionId: data?.connection?.id,
    githubLogin: data?.connection?.accountLogin,
    initiateGithubAuth,
    isAuthorized: data?.connection?.isAuthorized ?? false,
    isLoading: canCheck ? isLoading : false,
    mutate,
  };
}
