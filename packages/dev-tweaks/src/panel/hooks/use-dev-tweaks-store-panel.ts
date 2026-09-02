/* eslint-disable react-hooks/refs -- ported panel render-update patterns kept structurally intact */
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useSyncExternalStore,
} from "react";
import type {
  DevTweaksConfig,
  DevTweaksPersistOptions,
  DevTweaksValue,
  ShortcutConfig,
} from "../store/dev-tweaks-store";
import { DevTweaksStore } from "../store/dev-tweaks-store";

export interface UseDevTweaksStorePanelOptions {
  id?: string;
  kind?: "timeline";
  persist?: DevTweaksPersistOptions;
  shortcuts?: Record<string, ShortcutConfig>;
}

// Serialize with a referential short-circuit: consumers can re-render at 60Hz
// during timeline playback, and re-stringifying an unchanged config every
// frame is wasted work whenever the object is memoized or module-stable.
export function useSerialized(value: unknown): string {
  const ref = useRef<{ value: unknown; text: string } | undefined>(undefined);
  if (!(ref.current && Object.is(ref.current.value, value))) {
    ref.current = { value, text: JSON.stringify(value) };
  }
  return ref.current.text;
}

// The DevTweaksStore panel lifecycle shared by useDevTweaks and useDevTweaksTimeline:
// stable panel id, register on mount / unregister on unmount, push structure
// changes on config edits, and subscribe to the flat value snapshot.
// Fixes to StrictMode/HMR behavior belong here so every panel-backed hook
// gets them.
export function useDevTweaksStorePanel(
  name: string,
  config: DevTweaksConfig,
  options: UseDevTweaksStorePanelOptions = {}
): {
  panelId: string;
  flatValues: Record<string, DevTweaksValue>;
  serializedConfig: string;
} {
  const instanceId = useId();
  const hasStableId = options.id !== undefined;
  const panelId = options.id ?? `${name}-${instanceId}`;

  const configRef = useRef(config);
  configRef.current = config;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const serializedConfig = useSerialized(config);
  const _serializedShortcuts = useSerialized(options.shortcuts);
  const _serializedPersist = useSerialized(options.persist);

  // Register on mount
  useEffect(() => {
    DevTweaksStore.registerPanel(
      panelId,
      name,
      configRef.current,
      optionsRef.current.shortcuts,
      {
        retainOnUnmount: hasStableId,
        persist: optionsRef.current.persist,
        kind: optionsRef.current.kind,
      }
    );
    return () => DevTweaksStore.unregisterPanel(panelId);
  }, [hasStableId, panelId, name]);

  // Push structure changes without re-registering
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    DevTweaksStore.updatePanel(
      panelId,
      name,
      configRef.current,
      optionsRef.current.shortcuts,
      {
        retainOnUnmount: hasStableId,
        persist: optionsRef.current.persist,
        kind: optionsRef.current.kind,
      }
    );
  }, [hasStableId, panelId, name]);

  const subscribe = useCallback(
    (callback: () => void) => DevTweaksStore.subscribe(panelId, callback),
    [panelId]
  );
  const getSnapshot = useCallback(
    () => DevTweaksStore.getValues(panelId),
    [panelId]
  );

  // DevTweaksStore.getValues returns a stable empty object when panel is not registered.
  const flatValues = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return { panelId, flatValues, serializedConfig };
}
