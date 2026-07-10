/**
 * Pure geometry for the canvas "masked glass sheet". One shared
 * `backdrop-filter` sheet sits between the edges and nodes layers and is masked
 * to the union of node rounded-rects, so N per-node blur surfaces collapse to 1.
 * Nodes that overlap another node can't be blurred by the shared sheet (it
 * paints below every node), so they keep their own blur and drop out of the
 * mask. No React / xyflow deps here — this stays unit-testable.
 */

/**
 * Corner radius the mask rounds each hole to. Pinned to `--radius-lg`
 * (0.5rem = 8px), which `.canvas-node-surface`'s `rounded-lg` resolves to.
 */
export const CANVAS_GLASS_NODE_CORNER_RADIUS = 8;

/**
 * Blur radius of the shared sheet, in px. Mirrors the `--canvas-glass-blur-radius`
 * CSS token, which drives both `.canvas-glass-sheet` and the node surface's
 * `data-self-blur` rule (so an overlapping node's own blur matches the sheet).
 * Kept here as a number so the mask padding can be derived from it.
 */
export const CANVAS_GLASS_BLUR_RADIUS = 40;

/**
 * The sheet extends past the outermost node by ≥3σ so the blur sampled near the
 * edge holes reads real backdrop, not the sheet's own transparent margin.
 */
export const CANVAS_GLASS_SHEET_PADDING = CANVAS_GLASS_BLUR_RADIUS * 3;

export interface GlassNodeRect {
  height: number;
  id: string;
  width: number;
  x: number;
  y: number;
}

export interface GlassOverlapSplit {
  isolated: GlassNodeRect[];
  overlapping: Set<string>;
}

export interface GlassSheetGeometry {
  height: number;
  left: number;
  maskImage: string;
  maskPosition: string;
  top: number;
  width: number;
}

export function glassRectsOverlap(a: GlassNodeRect, b: GlassNodeRect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/**
 * Split nodes into those the shared sheet can blur (isolated) and those that
 * overlap another node and must keep their own blur.
 */
export function splitGlassOverlaps(rects: GlassNodeRect[]): GlassOverlapSplit {
  const overlapping = new Set<string>();
  for (const rect of rects) {
    if (
      rects.some((other) => other !== rect && glassRectsOverlap(rect, other))
    ) {
      overlapping.add(rect.id);
    }
  }
  return {
    isolated: rects.filter((rect) => !overlapping.has(rect.id)),
    overlapping,
  };
}

function roundedRectMaskUri(width: number, height: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="${CANVAS_GLASS_NODE_CORNER_RADIUS}" fill="black"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/**
 * Build the masked-sheet CSS geometry (canvas-space left/top/size + a layered
 * mask, one rounded-rect per isolated node). Returns null when nothing is
 * isolated, so the caller hides the sheet.
 */
export function buildGlassSheetGeometry(
  isolated: GlassNodeRect[]
): GlassSheetGeometry | null {
  if (isolated.length === 0) {
    return null;
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const rect of isolated) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  minX -= CANVAS_GLASS_SHEET_PADDING;
  minY -= CANVAS_GLASS_SHEET_PADDING;
  maxX += CANVAS_GLASS_SHEET_PADDING;
  maxY += CANVAS_GLASS_SHEET_PADDING;
  return {
    height: maxY - minY,
    left: minX,
    maskImage: isolated
      .map((rect) => roundedRectMaskUri(rect.width, rect.height))
      .join(","),
    maskPosition: isolated
      .map((rect) => `${rect.x - minX}px ${rect.y - minY}px`)
      .join(","),
    top: minY,
    width: maxX - minX,
  };
}

/**
 * Cheap fingerprint of node geometry. The sheet only needs to resync when this
 * changes, so pan/zoom (which never moves nodes in canvas space) is a no-op.
 */
export function glassRectsSignature(rects: GlassNodeRect[]): string {
  return rects
    .map(
      (rect) => `${rect.id}:${rect.x}:${rect.y}:${rect.width}:${rect.height}`
    )
    .join("|");
}
