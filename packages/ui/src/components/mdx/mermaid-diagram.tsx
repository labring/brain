"use client";

import { cn } from "@workspace/ui/lib/utils";
import { useTheme } from "next-themes";
import { type ReactNode, useEffect, useId, useState } from "react";
import { useIsCodeFenceIncomplete } from "streamdown";

// mermaid.render ids must be usable as element ids; useId emits colons.
const INVALID_ID_CHARS = /[^a-zA-Z0-9-]/g;

/**
 * Renders a mermaid code fence as a diagram. The mermaid library loads
 * lazily with the first diagram — never in the eager route or the composer
 * warm path. `fallback` (the highlighted source block) shows while the
 * fence is still streaming, while the chunk loads, and when the source
 * doesn't parse — so a broken diagram degrades to readable source instead
 * of an error box.
 */
export function MermaidDiagram({
  chart,
  className,
  fallback,
}: {
  chart: string;
  className?: string;
  fallback: ReactNode;
}) {
  const isIncomplete = useIsCodeFenceIncomplete();
  const { resolvedTheme } = useTheme();
  const renderId = `mmd-${useId().replace(INVALID_ID_CHARS, "")}`;
  const [svg, setSvg] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (isIncomplete) {
      return;
    }
    let active = true;
    setFailed(false);
    import("mermaid")
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({
          fontFamily: "var(--font-sans, sans-serif)",
          securityLevel: "strict",
          startOnLoad: false,
          suppressErrorRendering: true,
          theme: resolvedTheme === "dark" ? "dark" : "default",
        });
        const rendered = await mermaid.render(renderId, chart);
        if (active) {
          setSvg(rendered.svg);
        }
      })
      .catch(() => {
        if (active) {
          setFailed(true);
        }
      });
    return () => {
      active = false;
    };
  }, [chart, isIncomplete, renderId, resolvedTheme]);

  if (isIncomplete || failed || svg === "") {
    return <>{fallback}</>;
  }

  return (
    <div
      className={cn(
        "my-3 flex justify-center overflow-x-auto rounded-md border border-border/70 bg-background/45 p-3 [&_svg]:h-auto [&_svg]:max-w-full",
        className
      )}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid output under securityLevel "strict" is sanitized
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
