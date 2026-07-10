import { cjk } from "@streamdown/cjk";
import type { PluginConfig } from "streamdown";

const basePlugins: PluginConfig = { cjk };

let currentPlugins: PluginConfig = basePlugins;
let pendingLoad: Promise<PluginConfig> | null = null;

/** Plugins available right now: base-only until the heavy chunk resolves. */
export function getStreamdownPlugins(): PluginConfig {
  return currentPlugins;
}

/**
 * Loads the shiki/mermaid/katex plugin chunk. Idempotent (module-map cached),
 * so it is safe to fire ahead of need, e.g. on composer focus. A rejected
 * load resets the gate so a later call retries instead of caching the error.
 */
export function warmStreamdownPlugins(): Promise<PluginConfig> {
  pendingLoad ??= import("./streamdown-plugins-heavy")
    .then((heavyModule) => {
      currentPlugins = {
        ...basePlugins,
        ...heavyModule.heavyStreamdownPlugins,
      };
      return currentPlugins;
    })
    .catch((error: unknown) => {
      pendingLoad = null;
      throw error;
    });
  return pendingLoad;
}
