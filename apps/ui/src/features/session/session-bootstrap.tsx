"use client";

import { useSetAtom, useStore } from "jotai";
import { useEffect } from "react";
import { toast } from "sonner";

import {
  desktopDomainAtom,
  desktopLanguageAtom,
  sessionStatusAtom,
} from "@/lib/auth-store";

import {
  connectDesktopSdk,
  isInsideDesktopIframe,
  readDesktopDomain,
  readDesktopLanguage,
  readDesktopShellState,
} from "./desktop-sdk";
import { SessionExpiredOverlay } from "./session-expired-overlay";
import { SESSION_ERROR_CODES } from "./session-schema";
import { establishSession } from "./session-store";

export const NOT_MEMBER_NOTICE =
  "The Workspace Desktop had open is no longer in your list. You are in your Personal Workspace.";

/**
 * Establishes the Brain Session after mount (ADR-0083, spec §A.5): inside
 * the Desktop iframe it first reads Desktop's current `nsid` through the
 * SDK, then `POST /api/session { nsid }`; outside one it posts without a
 * `nsid` and lands in the Personal Workspace. Inside the iframe a missed
 * SDK handshake raises the generic session error instead of guessing
 * Personal — the shell is the only source of the current Workspace. Until
 * the session lands the shell keeps its existing empty-credentials state;
 * a 401 raises the "session expired" overlay this component also mounts.
 */
type ShellFacts = { error: "shell-miss" } | { nsid: string | null };

/**
 * Reads the SDK's shell facts and applies the language and domain to the
 * atoms. Inside the iframe a missed handshake returns an error rather
 * than "no shell": Desktop's shell is the only source of the current
 * Workspace, and guessing Personal here would mint credentials for the
 * wrong Workspace while Desktop's chrome still shows a Team one — the
 * overlay's reload retries the handshake. Outside an iframe (local
 * development) Personal remains the honest landing.
 */
async function readShellFacts(
  setDesktopLanguage: (language: string) => void,
  setDesktopDomain: (domain: string) => void
): Promise<ShellFacts> {
  const insideIframe = isInsideDesktopIframe();
  const [shell, language, domain] = await Promise.all([
    readDesktopShellState(),
    readDesktopLanguage(),
    insideIframe ? readDesktopDomain() : Promise.resolve(null),
  ]);
  setDesktopLanguage(language ?? "en");
  if (domain != null) {
    setDesktopDomain(domain);
  }
  if (insideIframe && shell == null) {
    return { error: "shell-miss" };
  }
  return { nsid: shell?.nsid ?? null };
}

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
      const facts = await readShellFacts(setDesktopLanguage, setDesktopDomain);
      if (cancelled) {
        return;
      }
      if ("error" in facts) {
        store.set(sessionStatusAtom, {
          code: SESSION_ERROR_CODES.desktopUnavailable,
          kind: "error",
        });
        return;
      }
      const result = await establishSession(store, { nsid: facts.nsid });
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
