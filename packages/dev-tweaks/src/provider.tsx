"use client";

import { createContext, type ReactNode, useContext, useState } from "react";

import { DevTweaksStore } from "./store";
import type { DevTweaksDriver } from "./types";

export const DevTweaksContext = createContext<DevTweaksStore | null>(null);

export interface DevTweaksProviderProps {
  children?: ReactNode;
  /**
   * Host persistence drivers, addressed from group defs by name via
   * `persistence: "<name>"`. Captured once on mount — the Provider is meant
   * to live at the host root for the whole session.
   */
  drivers?: Record<string, DevTweaksDriver>;
  /** Override the package's default sessionStorage key. */
  storageKey?: string;
}

/**
 * Owns the store. Mount once at the host root — persistent drivers must stay
 * in scope even while the screens that registered their groups are unmounted,
 * so the "Active" section can still edit them.
 */
export function DevTweaksProvider({
  children,
  drivers,
  storageKey,
}: DevTweaksProviderProps) {
  const [store] = useState(() => new DevTweaksStore({ drivers, storageKey }));
  return (
    <DevTweaksContext.Provider value={store}>
      {children}
    </DevTweaksContext.Provider>
  );
}

/** Store accessor for the package's own components (panel, indicator). */
export function useDevTweaksStore(): DevTweaksStore | null {
  return useContext(DevTweaksContext);
}
