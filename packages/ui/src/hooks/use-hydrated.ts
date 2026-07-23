"use client";

import { useSyncExternalStore } from "react";

function subscribe() {
  return () => {
    // Hydration never un-happens; nothing to unsubscribe.
  };
}

function getSnapshot() {
  return true;
}

function getServerSnapshot() {
  return false;
}

/**
 * False during SSR and the matching hydration render, true on the client
 * afterwards. Gates client-only subtrees (portals, measured lists) without
 * the setState-in-effect "mounted" pattern.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
