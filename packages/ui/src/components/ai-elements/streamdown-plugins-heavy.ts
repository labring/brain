// KaTeX markup is unreadable without its stylesheet; shipping the CSS with
// this chunk keeps both the plugin and the stylesheet off eager routes.
import "katex/dist/katex.min.css";

import { math } from "@streamdown/math";
import type { PluginConfig } from "streamdown";

// Code and mermaid deliberately are not plugins here: the markdownComponents
// `pre`/`code` overrides replace Streamdown's plugin-aware code renderer, so
// plugin shiki/mermaid would never run. Highlighting goes through
// HighlightedCode (app shiki) and diagrams through MermaidDiagram instead.
export const heavyStreamdownPlugins = {
  math,
} satisfies Pick<PluginConfig, "math">;
