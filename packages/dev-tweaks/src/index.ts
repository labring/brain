"use client";

// Public surface of @workspace/dev-tweaks. Implementation origin: ./panel/ORIGIN.md
// biome-ignore lint/performance/noBarrelFile: package entry point.
export { type CssVarBinding, cssVarOverrides } from "./css-vars";
export { DevTweaksRoot } from "./panel/components/dev-tweaks-root";
export { useDevTweaks } from "./panel/hooks/use-dev-tweaks";
export type {
  DevTweaksConfig,
  ResolvedValues,
} from "./panel/store/dev-tweaks-store";
