"use client";

import { useSetAtom, useStore } from "jotai";
import { useEffect } from "react";
import { toast } from "sonner";

import { desktopDomainAtom, desktopLanguageAtom } from "@/lib/auth-store";

import {
  connectDesktopSdk,
  isInsideDesktopIframe,
  readDesktopDomain,
  readDesktopLanguage,
  readDesktopShellState,
} from "./desktop-sdk";
import { SessionExpiredOverlay } from "./session-expired-overlay";
import { establishSession } from "./session-store";

export const NOT_MEMBER_NOTICE =
  "The Workspace Desktop had open is no longer in your list. You are in your Personal Workspace.";

/**
 * Establishes the Brain Session after mount (ADR-0083, spec §A.5): inside
 * the Desktop iframe it first reads Desktop's current `nsid` through the
 * SDK, then `POST /api/session { nsid }`; outside one it posts without a
 * `nsid` and lands in the Personal Workspace. Until the session lands the
 * shell keeps its existing empty-credentials state; a 401 raises the
 * "session expired" overlay this component also mounts.
 */
export function SessionBootstrap() {
  const store = useStore();
  const setDesktopLanguage = useSetAtom(desktopLanguageAtom);
  const setDesktopDomain = useSetAtom(desktopDomainAtom);

  useEffect(() => {
    let cancelled = false;
    const disconnect = connectDesktopSdk({
      onLanguageChange: setDesktopLanguage,
    });

    const run = async () => {
      const [shell, language, domain] = await Promise.all([
        readDesktopShellState(),
        readDesktopLanguage(),
        isInsideDesktopIframe() ? readDesktopDomain() : Promise.resolve(null),
      ]);
      if (cancelled) {
        return;
      }
      setDesktopLanguage(language ?? "en");
      if (domain != null) {
        setDesktopDomain(domain);
      }
      const result = await establishSession(store, {
        nsid: shell?.nsid ?? null,
      });
      if (cancelled) {
        return;
      }
      if (result.kind === "ok" && result.session.fallback === "not_member") {
        toast(NOT_MEMBER_NOTICE);
      }
    };

    run().catch((error: unknown) => {
      if (!cancelled) {
        console.warn("[SessionBootstrap] establish failed:", error);
      }
    });

    return () => {
      cancelled = true;
      disconnect();
    };
  }, [setDesktopDomain, setDesktopLanguage, store]);

  return <SessionExpiredOverlay />;
}
