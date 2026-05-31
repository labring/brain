export type CanvasAnchorSide = "bottom" | "left" | "right" | "top";

export interface CanvasNodeGeometry {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface CanvasNodeGeometrySource {
  id: string;
  measured?: {
    height?: number;
    width?: number;
  };
  position: {
    x: number;
    y: number;
  };
}

export interface CanvasAnchorPair {
  sourceSide: CanvasAnchorSide;
  targetSide: CanvasAnchorSide;
}

export interface SelectCanvasAnchorPairOptions {
  crossAxisPenalty?: number;
  dragging?: boolean;
  hysteresisThreshold?: number;
  previousPair?: CanvasAnchorPair;
  source: CanvasNodeGeometry;
  target: CanvasNodeGeometry;
}

interface AnchorPoint {
  x: number;
  y: number;
}

const ANCHOR_SIDES = ["top", "right", "bottom", "left"] as const;
export const CROSS_AXIS_PENALTY = 2;
export const HYSTERESIS_THRESHOLD = 0.88;
export const CANVAS_NODE_FALLBACK_WIDTH = 272;
export const CANVAS_NODE_FALLBACK_HEIGHT = 62;

export const CANVAS_ANCHOR_PAIRS = ANCHOR_SIDES.flatMap((sourceSide) =>
  ANCHOR_SIDES.filter((targetSide) => targetSide !== sourceSide).map(
    (targetSide) => ({ sourceSide, targetSide })
  )
);

const SIDE_AXIS = {
  bottom: "vertical",
  left: "horizontal",
  right: "horizontal",
  top: "vertical",
} as const satisfies Record<CanvasAnchorSide, "horizontal" | "vertical">;

export function isCrossAxisAnchorPair(pair: CanvasAnchorPair): boolean {
  return SIDE_AXIS[pair.sourceSide] !== SIDE_AXIS[pair.targetSide];
}

function anchorPoint(
  geometry: CanvasNodeGeometry,
  side: CanvasAnchorSide
): AnchorPoint {
  switch (side) {
    case "top":
      return { x: geometry.x + geometry.width / 2, y: geometry.y };
    case "right":
      return {
        x: geometry.x + geometry.width,
        y: geometry.y + geometry.height / 2,
      };
    case "bottom":
      return {
        x: geometry.x + geometry.width / 2,
        y: geometry.y + geometry.height,
      };
    case "left":
      return { x: geometry.x, y: geometry.y + geometry.height / 2 };
    default: {
      const exhaustiveSide: never = side;
      throw new Error(`Unsupported anchor side: ${exhaustiveSide}`);
    }
  }
}

function distance(source: AnchorPoint, target: AnchorPoint): number {
  return Math.hypot(source.x - target.x, source.y - target.y);
}

function measuredDimension(
  value: number | undefined,
  fallback: number
): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function canvasNodeGeometryFromNode(
  node: CanvasNodeGeometrySource
): CanvasNodeGeometry {
  return {
    height: measuredDimension(
      node.measured?.height,
      CANVAS_NODE_FALLBACK_HEIGHT
    ),
    width: measuredDimension(node.measured?.width, CANVAS_NODE_FALLBACK_WIDTH),
    x: node.position.x,
    y: node.position.y,
  };
}

function pairScore({
  crossAxisPenalty,
  pair,
  source,
  target,
}: {
  crossAxisPenalty: number;
  pair: CanvasAnchorPair;
  source: CanvasNodeGeometry;
  target: CanvasNodeGeometry;
}): number {
  const multiplier = isCrossAxisAnchorPair(pair) ? crossAxisPenalty : 1;

  return (
    distance(
      anchorPoint(source, pair.sourceSide),
      anchorPoint(target, pair.targetSide)
    ) * multiplier
  );
}

export function selectCanvasAnchorPair({
  crossAxisPenalty = CROSS_AXIS_PENALTY,
  dragging = false,
  hysteresisThreshold = HYSTERESIS_THRESHOLD,
  previousPair,
  source,
  target,
}: SelectCanvasAnchorPairOptions): CanvasAnchorPair {
  let bestPair: CanvasAnchorPair = { sourceSide: "top", targetSide: "right" };
  let bestScore = Number.POSITIVE_INFINITY;

  for (const pair of CANVAS_ANCHOR_PAIRS) {
    const nextScore = pairScore({
      crossAxisPenalty,
      pair,
      source,
      target,
    });

    if (nextScore < bestScore) {
      bestPair = pair;
      bestScore = nextScore;
    }
  }

  if (dragging && previousPair !== undefined) {
    const previousScore = pairScore({
      crossAxisPenalty,
      pair: previousPair,
      source,
      target,
    });
    if (bestScore >= hysteresisThreshold * previousScore) {
      return previousPair;
    }
  }

  return bestPair;
}
