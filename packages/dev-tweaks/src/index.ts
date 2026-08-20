"use client";

// Public surface of @workspace/dev-tweaks. Implementation origin: ./panel/ORIGIN.md
// biome-ignore lint/performance/noBarrelFile: package entry point.
export { type CssVarBinding, cssVarOverrides } from "./css-vars";
export { DevTweaksRoot } from "./panel/components/dev-tweaks-root";
export { useDevTweaks } from "./panel/hooks/use-dev-tweaks";
export { useDevTweaksMock } from "./panel/hooks/use-dev-tweaks-mock";
export type {
  DevTweaksConfig,
  ResolvedValues,
} from "./panel/store/dev-tweaks-store";
export type {
  DevTweaksMockDef,
  DevTweaksMockSource,
  DevTweaksMockState,
} from "./panel/store/mock-store";
