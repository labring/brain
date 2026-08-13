"use client";

import {
  type CSSProperties,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";

import { formatCssValue } from "./format";
import { DevTweaksContext } from "./provider";
import { EMPTY_OVERRIDE_VALUES } from "./store";
import type {
  DevTweaksControlDef,
  DevTweaksGroupDef,
  DevTweaksValue,
  DevTweaksValues,
} from "./types";

const noopSubscribe = () => () => {
  // Without a Provider (e.g. production) there is nothing to subscribe to.
};

const getEmptyOverrides = () => EMPTY_OVERRIDE_VALUES;

/**
 * Registers a group of controls with the dev tweaks panel while mounted and
 * returns the live values plus a `style` object carrying overridden CSS
 * custom properties — spread it onto the element whose CSS reads those vars.
 * CSS defaults stay the source of truth: `style` only carries overrides.
 *
 * Define `def` at module scope so the result stays referentially stable.
 * Without a `DevTweaksProvider` above (production builds) this is inert:
 * nothing registers, `style` is empty, and `values` are the defaults.
 */
export function useDevTweaks<T extends Record<string, DevTweaksControlDef>>(
  key: string,
  def: DevTweaksGroupDef<T>
): { style: CSSProperties; values: DevTweaksValues<T> } {
  const store = useContext(DevTweaksContext);
  const overrides = useSyncExternalStore(
    store ? store.subscribe : noopSubscribe,
    store ? () => store.getOverrides(key) : getEmptyOverrides,
    getEmptyOverrides
  );

  useEffect(() => {
    if (!store) {
      return;
    }
    return store.register(key, def);
  }, [def, key, store]);

  return useMemo(() => {
    const style: Record<string, string> = {};
    const values: Record<string, DevTweaksValue> = {};
    for (const [controlKey, controlDef] of Object.entries<DevTweaksControlDef>(
      def.controls
    )) {
      const override = overrides[controlKey];
      values[controlKey] = override ?? controlDef.value;
      if (
        override !== undefined &&
        "cssVar" in controlDef &&
        controlDef.cssVar
      ) {
        style[controlDef.cssVar] = formatCssValue(controlDef, override);
      }
    }
    return {
      style: style as CSSProperties,
      values: values as DevTweaksValues<T>,
    };
  }, [def, overrides]);
}
