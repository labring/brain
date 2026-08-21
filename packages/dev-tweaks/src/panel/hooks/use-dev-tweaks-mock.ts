/* eslint-disable react-hooks/refs -- same render-update pattern as the other panel hooks */
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { DevTweaksMockDef, DevTweaksMockState } from "../store/mock-store";
import { MockStore } from "../store/mock-store";

/** Stable pre-registration snapshot (server render and first client render). */
const UNREGISTERED_STATE: DevTweaksMockState = Object.freeze({
  enabled: false,
  scenario: "",
});

/**
 * Registers a mock with the dev tweaks panel while the caller is mounted.
 * The mock's truth stays in `def.source`; the returned state is the panel's
 * current view of it. Mount this from the screens the mock affects — the
 * mock leaves the panel when the last registration unmounts.
 */
export function useDevTweaksMock(
  key: string,
  def: DevTweaksMockDef
): DevTweaksMockState {
  const defRef = useRef(def);
  defRef.current = def;

  // Def edits are adopted on remount (register() re-reads the latest def
  // when the key is already registered) — same HMR posture as tweaks panels.
  useEffect(() => {
    MockStore.register(key, defRef.current);
    return () => MockStore.unregister(key);
  }, [key]);

  const subscribe = useCallback(
    (callback: () => void) => MockStore.subscribe(callback),
    []
  );
  const getSnapshot = useCallback(
    () => MockStore.getState(key) ?? UNREGISTERED_STATE,
    [key]
  );
  return useSyncExternalStore(subscribe, getSnapshot, () => UNREGISTERED_STATE);
}
