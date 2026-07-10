// KaTeX markup is unreadable without its stylesheet; shipping the CSS with
// this chunk keeps both the plugins and the stylesheet off eager routes.
import "katex/dist/katex.min.css";

import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import type { PluginConfig } from "streamdown";

export const heavyStreamdownPlugins = {
  code,
  math,
  mermaid,
} satisfies Pick<PluginConfig, "code" | "math" | "mermaid">;
