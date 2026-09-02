/* eslint-disable react-hooks/refs -- ported panel render-update patterns kept structurally intact */
import { useCallback, useEffect, useMemo, useRef } from "react";
import type {
  DevTweaksConfig,
  DevTweaksPersistOptions,
  DevTweaksValue,
  DevTweaksValueUpdates,
  ResolvedValues,
  ShortcutConfig,
} from "../store/dev-tweaks-store";
import {
  DevTweaksStore,
  flattenDevTweaksValueUpdates,
  resolveDevTweaksValues,
} from "../store/dev-tweaks-store";
import { useDevTweaksStorePanel } from "./use-dev-tweaks-store-panel";

export interface UseDevTweaksOptions {
  id?: string;
  onAction?: (action: string) => void;
  persist?: DevTweaksPersistOptions;
  shortcuts?: Record<string, ShortcutConfig>;
}

export interface DevTweaksController<T extends DevTweaksConfig> {
  getValues: () => ResolvedValues<T>;
  resetValues: () => void;
  setValue: (path: string, value: DevTweaksValue) => void;
  setValues: (values: DevTweaksValueUpdates<T>) => void;
  values: ResolvedValues<T>;
}

export function useDevTweaks<T extends DevTweaksConfig>(
  name: string,
  config: T,
  options?: UseDevTweaksOptions
): ResolvedValues<T> {
  return useDevTweaksController(name, config, options).values;
}

export function useDevTweaksController<T extends DevTweaksConfig>(
  name: string,
  config: T,
  options?: UseDevTweaksOptions
): DevTweaksController<T> {
  const { panelId, flatValues } = useDevTweaksStorePanel(name, config, {
    id: options?.id,
    persist: options?.persist,
    shortcuts: options?.shortcuts,
  });

  const configRef = useRef(config);
  configRef.current = config;
  const onActionRef = useRef(options?.onAction);
  onActionRef.current = options?.onAction;

  // Subscribe to action events
  useEffect(() => {
    return DevTweaksStore.subscribeActions(panelId, (action) => {
      onActionRef.current?.(action);
    });
  }, [panelId]);

  const values = useMemo(
    () => resolveDevTweaksValues(configRef.current, flatValues),

    [flatValues]
  );

  const setValue = useCallback(
    (path: string, value: DevTweaksValue) => {
      DevTweaksStore.updateValue(panelId, path, value);
    },
    [panelId]
  );

  const setValues = useCallback(
    (nextValues: DevTweaksValueUpdates<T>) => {
      DevTweaksStore.updateValues(
        panelId,
        flattenDevTweaksValueUpdates(configRef.current, nextValues)
      );
    },
    [panelId]
  );

  const resetValues = useCallback(() => {
    DevTweaksStore.resetValues(panelId);
  }, [panelId]);

  const getValues = useCallback(
    () =>
      resolveDevTweaksValues(
        configRef.current,
        DevTweaksStore.getValues(panelId)
      ),
    [panelId]
  );

  return useMemo(
    () => ({
      values,
      setValue,
      setValues,
      resetValues,
      getValues,
    }),
    [getValues, resetValues, setValue, setValues, values]
  );
}
