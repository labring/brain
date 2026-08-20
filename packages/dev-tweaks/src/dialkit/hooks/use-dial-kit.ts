/* eslint-disable react-hooks/refs -- ported DialKit render-update patterns kept structurally intact */
import { useCallback, useEffect, useMemo, useRef } from "react";
import type {
  DialConfig,
  DialKitPersistOptions,
  DialKitValueUpdates,
  DialValue,
  ResolvedValues,
  ShortcutConfig,
} from "../store/dial-store";
import {
  DialStore,
  flattenDialValueUpdates,
  resolveDialValues,
} from "../store/dial-store";
import { useDialStorePanel } from "./use-dial-store-panel";

export interface UseDialOptions {
  id?: string;
  onAction?: (action: string) => void;
  persist?: DialKitPersistOptions;
  shortcuts?: Record<string, ShortcutConfig>;
}

export interface DialKitController<T extends DialConfig> {
  getValues: () => ResolvedValues<T>;
  resetValues: () => void;
  setValue: (path: string, value: DialValue) => void;
  setValues: (values: DialKitValueUpdates<T>) => void;
  values: ResolvedValues<T>;
}

export function useDialKit<T extends DialConfig>(
  name: string,
  config: T,
  options?: UseDialOptions
): ResolvedValues<T> {
  return useDialKitController(name, config, options).values;
}

export function useDialKitController<T extends DialConfig>(
  name: string,
  config: T,
  options?: UseDialOptions
): DialKitController<T> {
  const { panelId, flatValues } = useDialStorePanel(name, config, {
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
    return DialStore.subscribeActions(panelId, (action) => {
      onActionRef.current?.(action);
    });
  }, [panelId]);

  const values = useMemo(
    () => resolveDialValues(configRef.current, flatValues),

    [flatValues]
  );

  const setValue = useCallback(
    (path: string, value: DialValue) => {
      DialStore.updateValue(panelId, path, value);
    },
    [panelId]
  );

  const setValues = useCallback(
    (nextValues: DialKitValueUpdates<T>) => {
      DialStore.updateValues(
        panelId,
        flattenDialValueUpdates(configRef.current, nextValues)
      );
    },
    [panelId]
  );

  const resetValues = useCallback(() => {
    DialStore.resetValues(panelId);
  }, [panelId]);

  const getValues = useCallback(
    () => resolveDialValues(configRef.current, DialStore.getValues(panelId)),
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
