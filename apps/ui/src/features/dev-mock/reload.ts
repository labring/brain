"use client";

import { preserveDevTweaksPanelAcrossReload } from "@workspace/dev-tweaks";

/**
 * Revalidation-by-reload for Dev Mocks whose consumers hold non-SWR state (a
 * chat session bootstrap, SSE connections): the one honest way to reconnect
 * them to (or off) the fixtures. Keeps the dev tweaks panel open across the
 * navigation so the toggle's result is visible where it was clicked.
 */
export function reloadForDevMock(): void {
  preserveDevTweaksPanelAcrossReload();
  window.location.reload();
}
