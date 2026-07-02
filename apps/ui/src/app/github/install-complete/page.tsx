"use client";

import { useEffect } from "react";

import {
  GITHUB_APP_INSTALL_COMPLETE_MESSAGE,
  parseInstallReturnPathParam,
} from "@/lib/github-app/types";

function installReturnPath(): string {
  if (typeof window === "undefined") {
    return "/";
  }
  const url = new URL(window.location.href);
  return parseInstallReturnPathParam(url.searchParams.get("next")) ?? "/";
}

export default function GithubInstallCompletePage() {
  useEffect(() => {
    const returnPath = installReturnPath();
    if (!window.opener) {
      window.location.replace(returnPath);
      return;
    }
    window.opener.postMessage(
      { returnPath, type: GITHUB_APP_INSTALL_COMPLETE_MESSAGE },
      window.location.origin
    );
    window.close();
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background text-foreground">
      <p className="text-muted-foreground text-sm">
        GitHub App installation complete. You can close this window.
      </p>
    </main>
  );
}
