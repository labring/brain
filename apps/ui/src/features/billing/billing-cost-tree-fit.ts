/** Content-space axis-aligned bounds of visible cost-tree nodes. */
export interface CostTreeContentBounds {
  maxX: number;
  maxY: number;
  minX: number;
  minY: number;
}

export interface CostTreeFitPadding {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

export interface CostTreeFitInput {
  bounds: CostTreeContentBounds;
  /** Upper clamp for auto-fit (user zoom may go higher). */
  maxScale: number;
  minScale: number;
  padding: CostTreeFitPadding;
  /** Width of the floating detail panel covering the right side of the canvas. */
  panelRightInset: number;
  viewportHeight: number;
  viewportWidth: number;
}

export interface CostTreeFitResult {
  positionX: number;
  positionY: number;
  scale: number;
}

/**
 * Fit visible cost-tree content into the usable viewport rectangle (container
 * minus the right detail panel and asymmetric padding). Top-left aligned so
 * Total → Region stay preferred when minScale still overflows.
 */
export function computeCostTreeFit(input: CostTreeFitInput): CostTreeFitResult {
  const {
    bounds,
    maxScale,
    minScale,
    padding,
    panelRightInset,
    viewportHeight,
    viewportWidth,
  } = input;

  const usableLeft = padding.left;
  const usableTop = padding.top;
  const usableWidth = Math.max(
    1,
    viewportWidth - panelRightInset - padding.right - padding.left
  );
  const usableHeight = Math.max(
    1,
    viewportHeight - padding.bottom - padding.top
  );

  const contentWidth = Math.max(1, bounds.maxX - bounds.minX);
  const contentHeight = Math.max(1, bounds.maxY - bounds.minY);

  const rawScale = Math.min(
    usableWidth / contentWidth,
    usableHeight / contentHeight
  );
  const scale = Math.min(maxScale, Math.max(minScale, rawScale));

  // Top-left: content min corner lands at the usable top-left.
  const positionX = usableLeft - bounds.minX * scale;
  const positionY = usableTop - bounds.minY * scale;

  return { positionX, positionY, scale };
}

/** Union node rects (content-space) into a single bounds box. */
export function unionContentBounds(
  rects: ReadonlyArray<{
    height: number;
    width: number;
    x: number;
    y: number;
  }>
): CostTreeContentBounds | null {
  if (rects.length === 0) {
    return null;
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const rect of rects) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  return { maxX, maxY, minX, minY };
}
