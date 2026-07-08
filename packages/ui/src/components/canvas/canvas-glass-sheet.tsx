"use client";

import {
  type InternalNode,
  type Node,
  useNodesInitialized,
  useStore,
  useStoreApi,
} from "@xyflow/react";
import { useLayoutEffect } from "react";
import {
  buildGlassSheetGeometry,
  type GlassNodeRect,
  type GlassSheetGeometry,
  glassRectsSignature,
  splitGlassOverlaps,
} from "./canvas-glass-geometry";
import type { CanvasGlassStore } from "./canvas-glass-store";

const EMPTY_OVERLAPPING: ReadonlySet<string> = new Set();

function readGlassNodeRects(
  nodeLookup: Map<string, InternalNode<Node>>
): GlassNodeRect[] {
  const rects: GlassNodeRect[] = [];
  for (const node of nodeLookup.values()) {
    if (node.hidden === true) {
      continue;
    }
    const width = node.measured?.width ?? 0;
    const height = node.measured?.height ?? 0;
    if (width === 0 || height === 0) {
      continue;
    }
    const { x, y } = node.internals.positionAbsolute;
    rects.push({ height, id: node.id, width, x, y });
  }
  return rects;
}

function applyGlassSheetGeometry(
  sheet: HTMLElement,
  geometry: GlassSheetGeometry | null
) {
  if (geometry == null) {
    sheet.style.display = "none";
    return;
  }
  sheet.style.display = "block";
  sheet.style.left = `${geometry.left}px`;
  sheet.style.top = `${geometry.top}px`;
  sheet.style.width = `${geometry.width}px`;
  sheet.style.height = `${geometry.height}px`;
  sheet.style.setProperty("mask-image", geometry.maskImage);
  sheet.style.setProperty("-webkit-mask-image", geometry.maskImage);
  sheet.style.setProperty("mask-position", geometry.maskPosition);
  sheet.style.setProperty("-webkit-mask-position", geometry.maskPosition);
}

/**
 * Renders the shared "masked glass sheet" (AIM-17): one `backdrop-filter`
 * element inserted between the edges and nodes layers of this canvas's React
 * Flow viewport, masked to the union of isolated node rounded-rects so N
 * per-node blur surfaces collapse to one. Geometry is read from the React Flow
 * store (not the DOM) and written imperatively once per frame, so the canvas
 * never re-renders; overlap membership is published to `store` so overlapping
 * nodes restore their own blur.
 *
 * React Flow exposes no declarative slot between the edges and nodes layers
 * (`ViewportPortal` renders after nodes), so the sheet element is inserted with
 * a single deterministic `insertBefore` keyed on the stable viewport DOM node.
 */
export function CanvasGlassSheet({ store }: { store: CanvasGlassStore }) {
  const rfStore = useStoreApi();
  const domNode = useStore((state) => state.domNode);
  const nodesInitialized = useNodesInitialized();

  useLayoutEffect(() => {
    if (domNode == null || !nodesInitialized) {
      return;
    }
    const viewport = domNode.querySelector<HTMLElement>(
      ".react-flow__viewport"
    );
    const nodesLayer =
      viewport?.querySelector<HTMLElement>(".react-flow__nodes");
    if (viewport == null || nodesLayer == null) {
      return;
    }

    const sheet = document.createElement("div");
    sheet.className = "canvas-glass-sheet";
    sheet.setAttribute("aria-hidden", "true");
    viewport.insertBefore(sheet, nodesLayer);

    let frame = 0;
    let signature = "";
    const sync = () => {
      frame = 0;
      const rects = readGlassNodeRects(rfStore.getState().nodeLookup);
      const nextSignature = glassRectsSignature(rects);
      if (nextSignature === signature) {
        return;
      }
      signature = nextSignature;
      const { isolated, overlapping } = splitGlassOverlaps(rects);
      applyGlassSheetGeometry(sheet, buildGlassSheetGeometry(isolated));
      store.setSnapshot({ active: true, overlapping });
    };
    const schedule = () => {
      if (frame === 0) {
        frame = requestAnimationFrame(sync);
      }
    };

    const unsubscribe = rfStore.subscribe(schedule);
    schedule();

    return () => {
      unsubscribe();
      if (frame !== 0) {
        cancelAnimationFrame(frame);
      }
      sheet.remove();
      store.setSnapshot({ active: false, overlapping: EMPTY_OVERLAPPING });
    };
  }, [domNode, nodesInitialized, rfStore, store]);

  return null;
}
