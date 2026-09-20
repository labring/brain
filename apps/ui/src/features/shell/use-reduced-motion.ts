"use client";

import { useSyncExternalStore } from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(REDUCED_MOTION_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function snapshot(): boolean {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function serverSnapshot(): boolean {
  return false;
}

/**
 * Whether the viewer prefers reduced motion. For the few transitions that
 * pick a different class set under the preference (rather than a
 * `motion-reduce:` override), so tests can observe the choice in the DOM.
 * False on the server and until hydration.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
