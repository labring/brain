"use client";

import { isInsideDesktopIframe } from "@/features/session/desktop-sdk";

/**
 * The browser facts a Workspace switch depends on (spec §C.6), kept behind
 * one module so the Switcher's tests can stand in for the Desktop iframe:
 * whether Brain runs inside one (switching is Desktop's job, so outside an
 * iframe the rows are disabled), the embedding page's origin as a fallback
 * for the cloud domain, and the top-window navigation itself.
 */

/** Whether the page is embedded (in Desktop, or any parent frame). */
export function isSwitchAvailable(): boolean {
  return isInsideDesktopIframe();
}

/**
 * The Desktop origin when the host config never answered: the page that
 * embedded this iframe is Desktop, recorded as the referrer. Null without
 * a usable referrer.
 */
export function embeddingOrigin(): string | null {
  try {
    const referrer = document.referrer.trim();
    return referrer === "" ? null : new URL(referrer).origin;
  } catch {
    return null;
  }
}

/** Hands the top window to Desktop: the whole page leaves for the deep link. */
export function navigateTopWindow(url: string): void {
  const top = window.top ?? window;
  top.location.href = url;
}
