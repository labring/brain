"use client";

import {
  type CSSProperties,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";

import {
  type DevTweakDef,
  type DevTweaksGroupDef,
  devTweaksStore,
  EMPTY_DEV_TWEAK_OVERRIDES,
  formatDevTweakValue,
} from "./dev-tweaks-store";

const isDevBuild = process.env.NODE_ENV === "development";

const getServerOverrides = () => EMPTY_DEV_TWEAK_OVERRIDES;

export type DevTweakValues<T extends Record<string, DevTweakDef>> = Readonly<
  Record<keyof T, number>
>;

/**
 * Registers a group of tunable knobs with the dev tweaks pane (⌃⌥T) and
 * returns the live values plus a `style` object carrying overridden CSS
 * custom properties — spread it onto the element whose CSS reads those vars.
 *
 * Define `def` at module scope so the result stays referentially stable.
 * In production builds this is inert: nothing registers, `style` is empty,
 * and `values` are the defaults.
 */
export function useDevTweaks<T extends Record<string, DevTweakDef>>(
  key: string,
  def: DevTweaksGroupDef<T>
): { style: CSSProperties; values: DevTweakValues<T> } {
  const overrides = useSyncExternalStore(
    devTweaksStore.subscribe,
    () => devTweaksStore.getOverrides(key),
    getServerOverrides
  );

  useEffect(() => {
    if (!isDevBuild) {
      return;
    }
    return devTweaksStore.register(key, def);
  }, [def, key]);

  return useMemo(() => {
    const style: Record<string, string> = {};
    const values: Record<string, number> = {};
    for (const [tweakKey, tweakDef] of Object.entries<DevTweakDef>(
      def.tweaks
    )) {
      const override = overrides[tweakKey];
      values[tweakKey] = override ?? tweakDef.value;
      if (override !== undefined && tweakDef.cssVar) {
        style[tweakDef.cssVar] = formatDevTweakValue(tweakDef, override);
      }
    }
    return {
      style: style as CSSProperties,
      values: values as DevTweakValues<T>,
    };
  }, [def, overrides]);
}
