"use client";

import { AppDialog } from "@workspace/ui/components/app-dialog";
import { useAtomValue } from "jotai";
import { useCallback } from "react";

import { desktopDomainAtom, sessionStatusAtom } from "@/lib/auth-store";

import { isInsideDesktopIframe } from "./desktop-sdk";

const DESKTOP_DOMAIN_SCHEME_RE = /^https?:\/\//i;
const TRAILING_SLASHES_RE = /\/+$/;

/** Desktop's sign-in page for the deployment, or null without a domain. */
export function desktopSigninUrl(domain: string): string | null {
  const trimmed = domain.trim().replace(TRAILING_SLASHES_RE, "");
  if (trimmed === "") {
    return null;
  }
  const origin = DESKTOP_DOMAIN_SCHEME_RE.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  return `${origin}/signin`;
}

/**
 * The "session expired" overlay (spec §A.8): shown when the login cookie
 * itself is stale — the session's own 401, or a second 401 after a silent
 * re-exchange. It is click-through by design: a cross-origin frame cannot
 * navigate its top window without a user gesture, so the button hands
 * `window.top` to Desktop's sign-in page. Outside the Desktop iframe (local
 * development, where `DEV_GLOBAL_TOKEN` stands in for the cookie) there is
 * no Desktop to go to, so the button reloads once the token is refreshed.
 */
export function SessionExpiredOverlay() {
  const status = useAtomValue(sessionStatusAtom);
  const desktopDomain = useAtomValue(desktopDomainAtom);
  const signinUrl = desktopSigninUrl(desktopDomain);
  const inIframe = isInsideDesktopIframe();

  const handleSignIn = useCallback(() => {
    if (signinUrl != null && inIframe) {
      const top = window.top ?? window;
      top.location.href = signinUrl;
      return;
    }
    window.location.reload();
  }, [inIframe, signinUrl]);

  return (
    <AppDialog.Root
      onOpenChange={() => undefined}
      open={status.kind === "expired"}
    >
      <AppDialog.Content data-slot="session-expired" size="sm">
        <AppDialog.Header>
          <AppDialog.WarningIcon />
          <AppDialog.Title>Session expired</AppDialog.Title>
        </AppDialog.Header>
        <AppDialog.Body>
          <AppDialog.Description>
            {inIframe
              ? "Your Sealos sign-in has expired. Sign in again to keep working."
              : "The development session token has expired. Refresh DEV_GLOBAL_TOKEN from a signed-in Desktop, then reload."}
          </AppDialog.Description>
        </AppDialog.Body>
        <AppDialog.Footer>
          <AppDialog.Action autoFocus onClick={handleSignIn}>
            {inIframe ? "Sign in again" : "Reload"}
          </AppDialog.Action>
        </AppDialog.Footer>
      </AppDialog.Content>
    </AppDialog.Root>
  );
}
