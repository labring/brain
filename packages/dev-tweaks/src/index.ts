"use client";

// Public surface of @workspace/dev-tweaks: the DialKit React API (forked
// upstream code, see ./dialkit/ORIGIN.md) plus the package's own CSS-var bridge.
// biome-ignore lint/performance/noBarrelFile: package entry point re-exporting the DialKit API.
export { type CssVarBinding, cssVarOverrides } from "./css-vars";
export * from "./dialkit/index";
