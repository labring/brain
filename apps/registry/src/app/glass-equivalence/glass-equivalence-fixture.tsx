"use client";

import { Canvas } from "@workspace/ui/components/canvas/canvas";
import type { CanvasMeta } from "@workspace/ui/components/canvas/canvas.types";
import { CanvasNode } from "@workspace/ui/components/canvas-node/canvas-node";
import type { Edge, Node, NodeProps, NodeTypes } from "@xyflow/react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

/**
 * Deterministic canvas for the snapshot-glass equivalence check
 * (e2e/glass-equivalence.mjs) and manual spot checks.
 *
 * Query params:
 * - `mode=live` forces the live backdrop-filter (snapshot disabled via the
 *   `<html data-canvas-glass="live">` escape hatch read by CanvasGlassSheet).
 * - `mode=off` hides the sheet entirely (the glass-off cost floor).
 * - `pings=1` adds paint-damaging dots above the glass, reproducing the
 *   idle-animation load that makes live backdrop-filter re-blur every frame.
 *
 * Node positions pin mask windows over the bloom center, a corner, and the
 * lower canvas, with edges crossing under windows and one overlapping pair
 * that must keep its own live blur (hybrid).
 */

interface GlassFixtureNodeData extends Record<string, unknown> {
  label: string;
  ping: boolean;
}

type GlassFixtureNode = Node<GlassFixtureNodeData, "glassFixtureNode">;

function GlassFixtureNodeView({ data }: NodeProps<GlassFixtureNode>) {
  return (
    <CanvasNode.Root>
      <CanvasNode.Placeholder aria-label={data.label}>
        <div className="flex h-16 w-56 items-center justify-between px-2">
          <span className="text-muted-foreground text-xs">{data.label}</span>
          {data.ping ? (
            <span aria-hidden className="flex gap-1">
              <span className="glass-e2e-ping" />
              <span className="glass-e2e-ping" />
              <span className="glass-e2e-ping" />
            </span>
          ) : null}
        </div>
      </CanvasNode.Placeholder>
      <CanvasNode.ConnectionAnchor />
    </CanvasNode.Root>
  );
}

const GLASS_FIXTURE_NODE_TYPES = {
  glassFixtureNode: GlassFixtureNodeView,
} as const satisfies NodeTypes;

const GLASS_FIXTURE_POSITIONS: ReadonlyArray<{
  id: string;
  label: string;
  x: number;
  y: number;
}> = [
  // Sits over the bloom center of the 1100×720 container at zoom 1.
  { id: "n-bloom", label: "bloom-center", x: 420, y: 300 },
  { id: "n-corner", label: "corner", x: 60, y: 48 },
  { id: "n-lower", label: "lower", x: 700, y: 520 },
  // Overlapping pair — excluded from the sheet, keeps live self-blur.
  { id: "n-over-a", label: "overlap-a", x: 720, y: 96 },
  { id: "n-over-b", label: "overlap-b", x: 800, y: 144 },
];

const GLASS_FIXTURE_EDGES: Edge[] = [
  { id: "e-corner-bloom", source: "n-corner", target: "n-bloom" },
  { id: "e-bloom-lower", source: "n-bloom", target: "n-lower" },
  { id: "e-corner-lower", source: "n-corner", target: "n-lower" },
];

const GLASS_FIXTURE_VIEWPORT = { x: 0, y: 0, zoom: 1 };

const PING_STYLE = `
.glass-e2e-ping {
  width: 22px;
  height: 22px;
  border-radius: 9999px;
  animation: glass-e2e-ping 0.5s linear infinite alternate;
}
@keyframes glass-e2e-ping {
  from { background-color: var(--color-blue-400); }
  to { background-color: var(--color-canvas-surface); }
}
`;

const OFF_STYLE = ".canvas-glass-sheet { display: none !important; }";

export function GlassEquivalenceFixture() {
  const searchParams = useSearchParams();
  const mode = searchParams.get("mode") === "live" ? "live" : null;
  const off = searchParams.get("mode") === "off";
  const pings = searchParams.get("pings") === "1";
  // Diagnostic: override the blur radius (e.g. blur=0 compares the raw
  // backdrop replication with the live sampling, no gaussian in either path).
  const blurOverride = searchParams.get("blur");
  const [ready, setReady] = useState(false);

  // The sheet reads the escape hatch when it mounts, so the dataset must be
  // in place before the canvas renders — gate mounting on this effect.
  useEffect(() => {
    if (mode === "live") {
      document.documentElement.dataset.canvasGlass = "live";
    } else {
      delete document.documentElement.dataset.canvasGlass;
    }
    setReady(true);
  }, [mode]);

  const meta = useMemo(
    (): CanvasMeta => ({
      nodeTypes: GLASS_FIXTURE_NODE_TYPES,
      reactFlowProps: {
        defaultViewport: GLASS_FIXTURE_VIEWPORT,
        fitView: false,
      },
    }),
    []
  );

  const state = useMemo(
    () => ({
      edges: GLASS_FIXTURE_EDGES,
      nodes: GLASS_FIXTURE_POSITIONS.map(
        ({ id, label, x, y }): GlassFixtureNode => ({
          data: { label, ping: pings },
          id,
          position: { x, y },
          type: "glassFixtureNode",
        })
      ),
      selectedEdge: null,
      selectedNode: null,
    }),
    [pings]
  );

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <style>{PING_STYLE}</style>
      {off ? <style>{OFF_STYLE}</style> : null}
      {blurOverride == null ? null : (
        <style>{`[data-glass-fixture] { --canvas-glass-blur-radius: ${Number.parseFloat(blurOverride) || 0}px; }`}</style>
      )}
      <div
        className="relative overflow-hidden rounded-xl border border-border"
        data-glass-fixture={off ? "off" : (mode ?? "snapshot")}
        style={{ height: 720, width: 1100 }}
      >
        {ready ? (
          <Canvas.Root meta={meta} state={state}>
            <Canvas.Flow />
          </Canvas.Root>
        ) : null}
      </div>
    </div>
  );
}
