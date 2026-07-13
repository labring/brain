/**
 * Effective visibility: whether the user can actually see this app.
 *
 * `document.visibilityState` only reflects the browser tab. When the app runs
 * embedded in the Sealos desktop, hidden windows are kept mounted with
 * `opacity: 0` on an ancestor in the PARENT document — the tab stays
 * "visible", timers run at foreground speed, and every poller keeps burning
 * the renderer main thread it shares with the desktop shell.
 *
 * This module folds two signals into one boolean:
 * - tab visibility (`visibilitychange`), identical to the old behavior;
 * - an IntersectionObserver v2 sentinel (`trackVisibility`) that sees
 *   ancestor-frame opacity/transform/occlusion across the iframe boundary.
 *
 * IOv2 `isVisible` is deliberately conservative (false while actually
 * visible is possible, e.g. content overlapping the frame edge), so the
 * sentinel is a 4px element at the viewport CENTER, painted above all
 * in-document content, and a not-visible report only flips the state after
 * it persists for a confirm window with no user interaction and no document
 * focus. Any interaction or a visible report resumes immediately. Browsers
 * without IOv2 (Firefox/Safari) never leave the visible state, which is
 * exactly the pre-existing behavior.
 */

export const EFFECTIVE_VISIBILITY_CONFIRM_HIDDEN_MS = 5000;
/** IOv2 requires `delay >= 100` when `trackVisibility` is on. */
const TRACK_VISIBILITY_DELAY_MS = 100;

type VisibilityTrackingObserverInit = IntersectionObserverInit & {
  delay?: number;
  trackVisibility?: boolean;
};

type VisibilityTrackingEntry = IntersectionObserverEntry & {
  isVisible?: boolean;
};

export interface EffectiveVisibilityTrackerOptions {
  /** Continuous not-visible time required before flipping hidden. */
  confirmHiddenMs?: number;
  /**
   * Focus probe checked before confirming hidden: a focused document means
   * the user is (or was last) interacting here, so a not-visible report is
   * treated as a false positive and re-checked one confirm window later.
   */
  hasFocus?: () => boolean;
}

export function createEffectiveVisibilityTracker(
  options?: EffectiveVisibilityTrackerOptions
) {
  const confirmHiddenMs =
    options?.confirmHiddenMs ?? EFFECTIVE_VISIBILITY_CONFIRM_HIDDEN_MS;
  const hasFocus =
    options?.hasFocus ??
    (() => (typeof document === "undefined" ? false : document.hasFocus()));

  let tabVisible = true;
  let embeddedVisible = true;
  /** Last IOv2 report; null until the sentinel produces one. */
  let sentinelVisible: boolean | null = null;
  let confirmTimer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<(visible: boolean) => void>();

  function isVisible() {
    return tabVisible && embeddedVisible;
  }

  function emitAfter(previous: boolean) {
    const next = isVisible();
    if (next === previous) {
      return;
    }
    for (const listener of [...listeners]) {
      listener(next);
    }
  }

  function cancelConfirm() {
    if (confirmTimer === null) {
      return;
    }
    clearTimeout(confirmTimer);
    confirmTimer = null;
  }

  function armConfirm() {
    if (confirmTimer !== null || !embeddedVisible) {
      return;
    }
    confirmTimer = setTimeout(() => {
      confirmTimer = null;
      if (sentinelVisible !== false) {
        return;
      }
      if (hasFocus()) {
        // Likely a conservative false positive — re-check next window.
        armConfirm();
        return;
      }
      const previous = isVisible();
      embeddedVisible = false;
      emitAfter(previous);
    }, confirmHiddenMs);
  }

  return {
    isVisible,
    /**
     * User input proves the app is visible right now. It also restarts the
     * confirm window: a stale not-visible sentinel state must re-earn the
     * hidden flip after the interaction stops.
     */
    reportInteraction() {
      cancelConfirm();
      if (!embeddedVisible) {
        const previous = isVisible();
        embeddedVisible = true;
        emitAfter(previous);
      }
      if (sentinelVisible === false) {
        armConfirm();
      }
    },
    reportSentinelVisibility(visible: boolean) {
      sentinelVisible = visible;
      if (visible) {
        cancelConfirm();
        if (!embeddedVisible) {
          const previous = isVisible();
          embeddedVisible = true;
          emitAfter(previous);
        }
        return;
      }
      armConfirm();
    },
    setTabVisible(visible: boolean) {
      if (visible === tabVisible) {
        return;
      }
      const previous = isVisible();
      tabVisible = visible;
      emitAfter(previous);
    },
    subscribe(listener: (visible: boolean) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

type EffectiveVisibilityTracker = ReturnType<
  typeof createEffectiveVisibilityTracker
>;

const INTERACTION_EVENTS = [
  "keydown",
  "pointerdown",
  "pointermove",
  "wheel",
] as const;

function installSentinel(tracker: EffectiveVisibilityTracker) {
  const sentinel = document.createElement("div");
  sentinel.setAttribute("data-slot", "effective-visibility-sentinel");
  sentinel.setAttribute("aria-hidden", "true");
  // Center of the viewport (edges get occluded by desktop chrome like the
  // dock), above every in-document stacking context so own content never
  // counts as occlusion. Transparent background keeps effective opacity 1.
  sentinel.style.cssText =
    "position:fixed;left:calc(50% - 2px);top:calc(50% - 2px);width:4px;height:4px;z-index:2147483647;pointer-events:none;background:transparent;";
  document.body.appendChild(sentinel);

  const observer = new IntersectionObserver(
    (entries) => {
      const entry = entries.at(-1) as VisibilityTrackingEntry | undefined;
      if (!entry) {
        return;
      }
      if (entry.isVisible === undefined) {
        // No IOv2 support — fall back to tab visibility only.
        observer.disconnect();
        sentinel.remove();
        return;
      }
      tracker.reportSentinelVisibility(entry.isVisible);
    },
    {
      delay: TRACK_VISIBILITY_DELAY_MS,
      threshold: 0,
      trackVisibility: true,
    } as VisibilityTrackingObserverInit
  );
  observer.observe(sentinel);
}

function installDomSources(tracker: EffectiveVisibilityTracker) {
  tracker.setTabVisible(document.visibilityState !== "hidden");
  document.addEventListener("visibilitychange", () => {
    tracker.setTabVisible(document.visibilityState !== "hidden");
  });

  const onInteraction = () => tracker.reportInteraction();
  for (const type of INTERACTION_EVENTS) {
    window.addEventListener(type, onInteraction, {
      capture: true,
      passive: true,
    });
  }

  try {
    if (document.body === null) {
      document.addEventListener(
        "DOMContentLoaded",
        () => installSentinel(tracker),
        { once: true }
      );
    } else {
      installSentinel(tracker);
    }
  } catch {
    // Observer construction failed — tab visibility keeps working alone.
  }
}

let sharedTracker: EffectiveVisibilityTracker | null = null;

function getSharedTracker(): EffectiveVisibilityTracker {
  if (sharedTracker === null) {
    sharedTracker = createEffectiveVisibilityTracker();
    installDomSources(sharedTracker);
  }
  return sharedTracker;
}

/** True while the user can plausibly see the app. Always true during SSR. */
export function isEffectivelyVisible(): boolean {
  if (typeof document === "undefined") {
    return true;
  }
  return getSharedTracker().isVisible();
}

/** Calls `listener` on every effective-visibility flip; returns unsubscribe. */
export function subscribeEffectiveVisibility(
  listener: (visible: boolean) => void
): () => void {
  if (typeof document === "undefined") {
    return () => undefined;
  }
  return getSharedTracker().subscribe(listener);
}
