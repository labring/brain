/**
 * Panel open-state bridge for full-page reloads. Some mocks can only
 * revalidate by reloading the page; without this, every such toggle also
 * closes the panel the user was working in. The root reports its open state
 * here; a reloading revalidator asks to reopen, and the flag survives the
 * navigation in sessionStorage (one shot, consumed on the next mount).
 */

const REOPEN_KEY = "dev-tweaks.reopen-once";

let panelOpen = false;

/** Called by the root whenever its open state settles or changes. */
export function reportPanelOpenState(open: boolean): void {
  panelOpen = open;
}

/**
 * Arms a one-shot "reopen after reload" request, but only while the panel is
 * actually open — a reload triggered while it is closed must not open it.
 * Call right before a revalidation-by-reload.
 */
export function preserveDevTweaksPanelAcrossReload(): void {
  if (!panelOpen || typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.setItem(REOPEN_KEY, "1");
  } catch {
    // The panel simply won't reopen.
  }
}

let consumedThisLoad: boolean | null = null;

/**
 * Reads and clears the reopen request; the root consumes it on mount. The
 * answer is cached for the page's lifetime so the call is idempotent —
 * StrictMode double-invokes state initializers, and the second invocation
 * must see the same answer, not "already consumed".
 */
export function consumePanelReopenRequest(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  if (consumedThisLoad !== null) {
    return consumedThisLoad;
  }
  try {
    const armed = window.sessionStorage.getItem(REOPEN_KEY) === "1";
    if (armed) {
      window.sessionStorage.removeItem(REOPEN_KEY);
    }
    consumedThisLoad = armed;
  } catch {
    consumedThisLoad = false;
  }
  return consumedThisLoad;
}

/** Test-only: clears the per-page-load cache a real reload would reset. */
export function resetPanelVisibilityForTests(): void {
  consumedThisLoad = null;
  panelOpen = false;
}
