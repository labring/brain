"use client";

import { useEffect } from "react";

import {
  GITHUB_APP_INSTALL_COMPLETE_CHANNEL,
  GITHUB_APP_INSTALL_COMPLETE_MESSAGE,
  GITHUB_APP_INSTALL_COMPLETE_STORAGE_KEY,
  parseInstallReturnPathParam,
} from "./types";

function installReturnPath(): string {
  if (typeof window === "undefined") {
    return "/";
  }
  const url = new URL(window.location.href);
  return parseInstallReturnPathParam(url.searchParams.get("next")) ?? "/";
}

function installState(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  const state = new URL(window.location.href).searchParams.get("state")?.trim();
  return state ? state : null;
}

function publishInstallComplete(
  returnPath: string,
  state: string | null
): void {
  if (state == null) {
    return;
  }
  const payload = {
    completedAt: Date.now(),
    returnPath,
    state,
    type: GITHUB_APP_INSTALL_COMPLETE_MESSAGE,
  };
  try {
    if ("BroadcastChannel" in window) {
      const channel = new BroadcastChannel(GITHUB_APP_INSTALL_COMPLETE_CHANNEL);
      channel.postMessage(payload);
      channel.close();
    }
  } catch {
    // BroadcastChannel can be unavailable in restricted browser contexts.
  }
  try {
    window.localStorage.setItem(
      GITHUB_APP_INSTALL_COMPLETE_STORAGE_KEY,
      JSON.stringify(payload)
    );
  } catch {
    // Local storage can be unavailable in restricted browser contexts.
  }
}

export function GithubInstallComplete() {
  useEffect(() => {
    const returnPath = installReturnPath();
    const state = installState();
    publishInstallComplete(returnPath, state);
    if (!window.opener) {
      window.location.replace(returnPath);
      return;
    }
    window.opener.postMessage(
      { returnPath, state, type: GITHUB_APP_INSTALL_COMPLETE_MESSAGE },
      window.location.origin
    );
    window.close();
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background text-foreground">
      <p className="text-muted-foreground text-sm">
        GitHub authorization complete. You can close this window.
      </p>
    </main>
  );
}
