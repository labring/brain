// @ts-nocheck — vendored upstream source, not held to workspace compiler options; see VENDOR.md
// Shared environment detection for dev-only rendering.

declare const process: { env?: { NODE_ENV?: string } } | undefined;

export const isDevDefault = typeof process !== 'undefined' && process?.env?.NODE_ENV
  ? process.env.NODE_ENV !== 'production'
  : typeof import.meta !== 'undefined' && (import.meta as any).env?.MODE
    ? (import.meta as any).env.MODE !== 'production'
    : true;
