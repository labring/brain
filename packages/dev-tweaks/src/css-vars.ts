import type { CSSProperties } from "react";

import type { DialConfig } from "./vendor/dialkit/store/DialStore";

/** CSS custom property (and optional unit) driven by one control key. */
export interface CssVarBinding {
  cssVar: `--${string}`;
  unit?: string;
}

/** Config default for one flat control, mirroring DialKit's resolution. */
function controlDefault(control: DialConfig[string] | undefined): unknown {
  if (Array.isArray(control)) {
    return control[0];
  }
  if (typeof control === "object" && control !== null) {
    // Spring/select/color/text configs carry `default`; folders (nested
    // configs) have no single default and are unsupported here.
    return "default" in control ? control.default : undefined;
  }
  return control;
}

/**
 * Style object carrying only *overridden* values as CSS custom properties —
 * spread it onto the element whose CSS reads those vars. CSS defaults stay
 * the source of truth: a control sitting at its config default writes
 * nothing, so production (always defaults) renders an empty style. Flat
 * configs only.
 */
export function cssVarOverrides<T extends DialConfig>(
  config: T,
  values: { readonly [K in keyof T]?: unknown },
  bindings: Partial<Record<keyof T & string, CssVarBinding>>
): CSSProperties {
  const style: Record<string, string> = {};
  for (const [key, binding] of Object.entries(bindings)) {
    if (!binding) {
      continue;
    }
    const value = values[key as keyof T];
    if (value === undefined || value === controlDefault(config[key])) {
      continue;
    }
    style[binding.cssVar] = `${String(value)}${binding.unit ?? ""}`;
  }
  return style as CSSProperties;
}
