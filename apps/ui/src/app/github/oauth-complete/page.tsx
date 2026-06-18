"use client";

import { useEffect } from "react";

import {
  GITHUB_OAUTH_COMPLETE_MESSAGE,
  parseOAuthReturnPathParam,
} from "@/lib/github-oauth/types";

function oauthReturnPath(): string {
  if (typeof window === "undefined") {
    return "/";
  }
  const url = new URL(window.location.href);
  return parseOAuthReturnPathParam(url.searchParams.get("next")) ?? "/";
}

export default function GithubOAuthCompletePage() {
  useEffect(() => {
    const returnPath = oauthReturnPath();
    if (!window.opener) {
      window.location.replace(returnPath);
      return;
    }
    window.opener.postMessage(
      { returnPath, type: GITHUB_OAUTH_COMPLETE_MESSAGE },
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
