"use client";

import { useAtomValue } from "jotai";
import { useCallback, useEffect, useRef } from "react";
import useSWR, { useSWRConfig } from "swr";
import {
  GITHUB_APP_INSTALL_COMPLETE_CHANNEL,
  GITHUB_APP_INSTALL_COMPLETE_MESSAGE,
  GITHUB_APP_INSTALL_COMPLETE_STORAGE_KEY,
  parseInstallNamespaceParam,
  parseInstallReturnPathParam,
} from "@/features/deploy/github/types";
import { githubReposSWRKey } from "@/features/deploy/github/use-github-repos";
import { appTokenRequestHeaders } from "@/lib/app-token-header";
import { appTokenAtom, kubeconfigAtom, namespaceAtom } from "@/lib/auth-store";

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
  githubLogin: string | undefined;
  initiateGithubAuth: () => void;
  isAuthorized: boolean;
  isLoading: boolean;
  mutate: () => Promise<unknown>;
}

async function fetchConnection(
  namespace: string,
  kubeconfig: string,
  appToken: string
): Promise<GithubConnectionResponse> {
  const url = new URL("/api/github/connection", window.location.origin);
  url.searchParams.set("namespace", namespace);
  const response = await fetch(url.toString(), {
    cache: "no-store",
    headers:
      kubeconfig.trim() === ""
        ? undefined
        : {
            Authorization: `Bearer ${encodeURIComponent(kubeconfig)}`,
            ...appTokenRequestHeaders(appToken),
          },
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return (await response.json()) as GithubConnectionResponse;
}

async function deleteConnection(
  namespace: string,
  kubeconfig: string,
  appToken: string
): Promise<void> {
  const url = new URL("/api/github/connection", window.location.origin);
  url.searchParams.set("namespace", namespace);
  const response = await fetch(url.toString(), {
    cache: "no-store",
    headers:
      kubeconfig.trim() === ""
        ? undefined
        : {
            Authorization: `Bearer ${encodeURIComponent(kubeconfig)}`,
            ...appTokenRequestHeaders(appToken),
          },
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
}

async function createOAuthSession(
  namespace: string,
  kubeconfig: string,
  appToken: string,
  returnPath: string
): Promise<{ authorizeUrl: string; state: string }> {
  const response = await fetch("/api/github/oauth-session", {
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...appTokenRequestHeaders(appToken),
    },
    method: "POST",
    body: JSON.stringify({
      encodedKubeconfig: encodeURIComponent(kubeconfig),
      namespace,
      returnPath,
    }),
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  const body = (await response.json()) as {
    authorizeUrl?: unknown;
    state?: unknown;
  };
  if (
    typeof body.authorizeUrl !== "string" ||
    body.authorizeUrl.trim() === ""
  ) {
    throw new Error("GitHub OAuth authorization URL was not returned.");
  }
  if (typeof body.state !== "string" || body.state.trim() === "") {
    throw new Error("GitHub OAuth authorization state was not returned.");
  }
  return { authorizeUrl: body.authorizeUrl, state: body.state };
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

function isGithubInstallCompleteMessage(
  data: unknown
): data is { returnPath?: unknown; state: string; type: string } {
  return (
    typeof data === "object" &&
    data != null &&
    "type" in data &&
    data.type === GITHUB_APP_INSTALL_COMPLETE_MESSAGE &&
    "state" in data &&
    typeof data.state === "string" &&
    data.state.trim() !== ""
  );
}

function parseStoredInstallCompleteMessage(
  raw: string | null
): { returnPath?: unknown; state: string; type: string } | null {
  if (raw == null || raw === "") {
    return null;
  }
  try {
    const data = JSON.parse(raw) as unknown;
    return isGithubInstallCompleteMessage(data) ? data : null;
  } catch {
    return null;
  }
}

export function githubInstallReturnPathForNavigation(
  data: unknown,
  options?: { applyReturnPath?: boolean }
): string | null {
  if (
    options?.applyReturnPath !== true ||
    !isGithubInstallCompleteMessage(data)
  ) {
    return null;
  }
  return sameOriginPath(data.returnPath);
}

function completedState(data: unknown): string | null {
  return isGithubInstallCompleteMessage(data) ? data.state.trim() : null;
}

export function useGithubAuth(options?: {
  enabled?: boolean;
}): UseGithubAuthResult {
  const enabled = options?.enabled ?? true;
  const appToken = useAtomValue(appTokenAtom);
  const kubeconfig = useAtomValue(kubeconfigAtom);
  const namespace = useAtomValue(namespaceAtom).trim();
  const canCheck = enabled && namespace !== "" && kubeconfig.trim() !== "";
  const { mutate: mutateCache } = useSWRConfig();
  const swrKey = canCheck
    ? (["github-connection", namespace, kubeconfig, appToken] as const)
    : null;

  const { data, error, isLoading, mutate } = useSWR(
    swrKey,
    () => fetchConnection(namespace, kubeconfig, appToken),
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

  const installCleanupRef = useRef<(() => void) | null>(null);
  const pendingInstallStateRef = useRef<string | null>(null);
  const handledInstallStatesRef = useRef<Set<string>>(new Set());

  const refreshConnection = useCallback(() => {
    if (!canCheck) {
      return;
    }
    mutate().catch(() => undefined);
    const reposKey = githubReposSWRKey({ appToken, kubeconfig, namespace });
    if (reposKey != null) {
      mutateCache(reposKey).catch(() => undefined);
    }
  }, [appToken, canCheck, kubeconfig, mutate, mutateCache, namespace]);

  const handleInstallComplete = useCallback(
    (data: unknown, options?: { applyReturnPath?: boolean }) => {
      if (!isGithubInstallCompleteMessage(data)) {
        return;
      }
      const state = completedState(data);
      if (
        state == null ||
        (state !== pendingInstallStateRef.current &&
          !handledInstallStatesRef.current.has(state))
      ) {
        return;
      }
      const alreadyHandled = handledInstallStatesRef.current.has(state);
      if (!alreadyHandled) {
        handledInstallStatesRef.current.add(state);
        installCleanupRef.current?.();
      }
      const returnPath = githubInstallReturnPathForNavigation(data, options);
      if (
        returnPath &&
        returnPath !== `${window.location.pathname}${window.location.search}`
      ) {
        window.history.replaceState(null, "", returnPath);
      }
      if (!alreadyHandled) {
        refreshConnection();
      }
    },
    [refreshConnection]
  );

  useEffect(() => {
    if (!canCheck) {
      return;
    }
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) {
        return;
      }
      handleInstallComplete(event.data, { applyReturnPath: true });
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== GITHUB_APP_INSTALL_COMPLETE_STORAGE_KEY) {
        return;
      }
      handleInstallComplete(parseStoredInstallCompleteMessage(event.newValue));
    };
    let channel: BroadcastChannel | undefined;
    if ("BroadcastChannel" in window) {
      channel = new BroadcastChannel(GITHUB_APP_INSTALL_COMPLETE_CHANNEL);
      channel.addEventListener("message", (event) => {
        handleInstallComplete(event.data);
      });
    }

    window.addEventListener("message", handleMessage);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("message", handleMessage);
      window.removeEventListener("storage", handleStorage);
      channel?.close();
      installCleanupRef.current?.();
    };
  }, [canCheck, handleInstallComplete]);

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
      if (closePoll !== undefined) {
        window.clearInterval(closePoll);
        closePoll = undefined;
      }
      if (installCleanupRef.current === cleanup) {
        installCleanupRef.current = null;
      }
      pendingInstallStateRef.current = null;
    };
    installCleanupRef.current = cleanup;

    const start = async (popup: Window | null) => {
      if (kubeconfig.trim() === "" || normalizedNamespace == null) {
        throw new Error("GitHub authorization requires workspace credentials.");
      }
      const { authorizeUrl, state } = await createOAuthSession(
        normalizedNamespace,
        kubeconfig,
        appToken,
        next
      );
      pendingInstallStateRef.current = state;
      handledInstallStatesRef.current.delete(state);
      if (popup == null) {
        window.location.assign(authorizeUrl);
        return;
      }
      popup.location.replace(authorizeUrl);
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
        "[github-auth] failed to create OAuth session:",
        startError
      );
    });
  }, [appToken, kubeconfig, namespace, refreshConnection]);

  const disconnectGithubAuth = useCallback(async () => {
    if (!canCheck) {
      return;
    }
    await deleteConnection(namespace, kubeconfig, appToken);
    await mutate({ connection: null }, { revalidate: false });
  }, [appToken, canCheck, kubeconfig, mutate, namespace]);

  return {
    canCheck,
    disconnectGithubAuth,
    error: err,
    githubLogin: data?.connection?.accountLogin,
    initiateGithubAuth,
    isAuthorized: data?.connection?.isAuthorized ?? false,
    isLoading: canCheck ? isLoading : false,
    mutate,
  };
}
