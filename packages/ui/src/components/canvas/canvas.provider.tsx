"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CanvasContext } from "./canvas.context";
import type {
  CanvasContextValue,
  CanvasInteractionMode,
  CanvasMeta,
  CanvasState,
} from "./canvas.types";

export function CanvasProvider({
  children,
  meta,
  state,
}: {
  children: ReactNode;
  meta?: CanvasMeta;
  state: CanvasState;
}) {
  const defaultInteractionMode: CanvasInteractionMode =
    meta?.defaultInteractionMode ?? "pointer";
  const [interactionMode, setInteractionMode] = useState<CanvasInteractionMode>(
    defaultInteractionMode
  );
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setInteractionMode(defaultInteractionMode);
  }, [defaultInteractionMode]);

  const value = useMemo<CanvasContextValue>(
    () => ({
      interactionMode,
      meta: meta ?? {},
      rootRef,
      setInteractionMode,
      state,
    }),
    [interactionMode, meta, state]
  );

  return <CanvasContext value={value}>{children}</CanvasContext>;
}
