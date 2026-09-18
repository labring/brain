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

/** Copy for the generic session error (spec §A.3): the code, never Desktop text. */
function sessionErrorDescription(code: string): string {
  if (code === "workspace_not_inited") {
    return "Your Sealos account has no Workspace in this region yet. Open Sealos Desktop to finish setting it up, then reload.";
  }
  if (code === "desktop_timeout") {
    return "Sealos Desktop did not answer in time. Reload to try again.";
  }
  return "Brain could not establish a session with Sealos Desktop. Reload to try again.";
}

/**
 * The session overlays (spec §A.3, §A.8). "Session expired" shows when the
 * login cookie itself is stale — the session's own 401, or a second 401
 * after a silent re-exchange. It is click-through by design: a cross-origin
 * frame cannot navigate its top window without a user gesture, so the
 * button hands `window.top` to Desktop's sign-in page. Outside the Desktop
 * iframe (local development, where `DEV_GLOBAL_TOKEN` stands in for the
 * cookie) there is no Desktop to go to, so the button reloads once the
 * token is refreshed. Any other establish failure shows the generic session
 * error with a reload.
 */
export function SessionExpiredOverlay() {
  const status = useAtomValue(sessionStatusAtom);
  const desktopDomain = useAtomValue(desktopDomainAtom);
  const inIframe = isInsideDesktopIframe();
  // The sign-in target comes only from the SDK host config's domain: the
  // embedding page is not proven to be Desktop (there is no frame-ancestors
  // policy), so a referrer fallback would aim `window.top` at a stranger.
  // Without a domain the button below reloads instead.
  const signinUrl = inIframe ? desktopSigninUrl(desktopDomain) : null;

  const handleSignIn = useCallback(() => {
    if (signinUrl != null) {
      const top = window.top ?? window;
      top.location.href = signinUrl;
      return;
    }
    window.location.reload();
  }, [signinUrl]);

  const handleReload = useCallback(() => {
    window.location.reload();
  }, []);

  if (status.kind === "error") {
    return (
      <AppDialog.Root onOpenChange={() => undefined} open>
        <AppDialog.Content data-slot="session-error" size="sm">
          <AppDialog.Header>
            <AppDialog.WarningIcon />
            <AppDialog.Title>Session unavailable</AppDialog.Title>
          </AppDialog.Header>
          <AppDialog.Body>
            <AppDialog.Description>
              {sessionErrorDescription(status.code)}
            </AppDialog.Description>
          </AppDialog.Body>
          <AppDialog.Footer>
            <AppDialog.Action autoFocus onClick={handleReload}>
              Reload
            </AppDialog.Action>
          </AppDialog.Footer>
        </AppDialog.Content>
      </AppDialog.Root>
    );
  }

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
            {signinUrl == null ? "Reload" : "Sign in again"}
          </AppDialog.Action>
        </AppDialog.Footer>
      </AppDialog.Content>
    </AppDialog.Root>
  );
}
