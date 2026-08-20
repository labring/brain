"use client";

// Public surface of @workspace/dev-tweaks: the vendored DialKit React API
// (see ./vendor/dialkit/VENDOR.md) plus the package's own CSS-var bridge.
// biome-ignore lint/performance/noBarrelFile: package entry point re-exporting the vendored API.
export { type CssVarBinding, cssVarOverrides } from "./css-vars";
export * from "./vendor/dialkit/index";
