import type { DevTweaksControlDef, DevTweaksValue } from "./types";

/** Formats an override for a CSS custom property write. */
export function formatCssValue(
  def: DevTweaksControlDef,
  value: DevTweaksValue
): string {
  if (def.type === "slider" || def.type === "number") {
    return `${value}${def.unit ?? ""}`;
  }
  return String(value);
}
