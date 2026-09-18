"use client";

import { isInsideDesktopIframe } from "@/features/session/desktop-sdk";

/**
 * The browser facts a Workspace switch depends on (spec §C.6), kept behind
 * one module so the Switcher's tests can stand in for the Desktop iframe:
 * whether Brain runs inside one (switching is Desktop's job, so outside an
 * iframe the rows are disabled) and the top-window navigation itself. The
 * cloud domain comes only from the SDK host config (spec §C.6) — never
 * from the embedding page, which under the local Dev Bridge is not Desktop.
 */

/** Whether the page is embedded (in Desktop, or any parent frame). */
export function isSwitchAvailable(): boolean {
  return isInsideDesktopIframe();
}

/** Hands the top window to Desktop: the whole page leaves for the deep link. */
export function navigateTopWindow(url: string): void {
  const top = window.top ?? window;
  top.location.href = url;
}
