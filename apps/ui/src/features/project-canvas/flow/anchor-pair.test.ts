import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CANVAS_ANCHOR_PAIRS,
  CANVAS_NODE_FALLBACK_HEIGHT,
  CANVAS_NODE_FALLBACK_WIDTH,
  canvasNodeGeometryFromNode,
  isCrossAxisAnchorPair,
  selectCanvasAnchorPair,
} from "./anchor-pair";

test("anchor pair selects the obvious same-axis pair for cardinal layouts", () => {
  const source = { height: 80, width: 160, x: 0, y: 0 };
  const cases = [
    {
      expected: { sourceSide: "right", targetSide: "left" },
      target: { height: 80, width: 160, x: 320, y: 0 },
    },
    {
      expected: { sourceSide: "left", targetSide: "right" },
      target: { height: 80, width: 160, x: -320, y: 0 },
    },
    {
      expected: { sourceSide: "top", targetSide: "bottom" },
      target: { height: 80, width: 160, x: 0, y: -240 },
    },
    {
      expected: { sourceSide: "bottom", targetSide: "top" },
      target: { height: 80, width: 160, x: 0, y: 240 },
    },
  ] as const;

  for (const { expected, target } of cases) {
    assert.deepEqual(selectCanvasAnchorPair({ source, target }), expected);
  }
});

test("anchor pair applies the cross-axis penalty when scoring diagonal layouts", () => {
  const source = { height: 100, width: 100, x: 0, y: 0 };
  const target = { height: 100, width: 100, x: 130, y: -130 };

  assert.deepEqual(
    selectCanvasAnchorPair({
      crossAxisPenalty: 1,
      source,
      target,
    }),
    {
      sourceSide: "top",
      targetSide: "left",
    }
  );

  assert.deepEqual(
    selectCanvasAnchorPair({
      crossAxisPenalty: 1.2,
      source,
      target,
    }),
    {
      sourceSide: "top",
      targetSide: "bottom",
    }
  );
});

test("anchor pair keeps the previous pair while dragging when the new best pair is within hysteresis", () => {
  const pair = selectCanvasAnchorPair({
    crossAxisPenalty: 1,
    dragging: true,
    previousPair: {
      sourceSide: "top",
      targetSide: "bottom",
    },
    source: { height: 100, width: 100, x: 0, y: 0 },
    target: { height: 100, width: 100, x: 80, y: -120 },
  });

  assert.deepEqual(pair, {
    sourceSide: "top",
    targetSide: "bottom",
  });
});

test("anchor pair switches while dragging when the new best pair clears hysteresis", () => {
  const pair = selectCanvasAnchorPair({
    crossAxisPenalty: 1,
    dragging: true,
    previousPair: {
      sourceSide: "top",
      targetSide: "bottom",
    },
    source: { height: 100, width: 100, x: 0, y: 0 },
    target: { height: 100, width: 100, x: 130, y: -130 },
  });

  assert.deepEqual(pair, {
    sourceSide: "top",
    targetSide: "left",
  });
});

test("anchor pair ignores previous state when not dragging", () => {
  const pair = selectCanvasAnchorPair({
    crossAxisPenalty: 1,
    dragging: false,
    previousPair: {
      sourceSide: "top",
      targetSide: "bottom",
    },
    source: { height: 100, width: 100, x: 0, y: 0 },
    target: { height: 100, width: 100, x: 80, y: -120 },
  });

  assert.deepEqual(pair, {
    sourceSide: "top",
    targetSide: "left",
  });
});

test("anchor pair is deterministic and does not mutate inputs", () => {
  const source = { height: 100, width: 100, x: 0, y: 0 };
  const target = { height: 100, width: 100, x: 130, y: -130 };
  const previousPair = {
    sourceSide: "top" as const,
    targetSide: "bottom" as const,
  };
  const sourceSnapshot = { ...source };
  const targetSnapshot = { ...target };
  const previousPairSnapshot = { ...previousPair };

  const first = selectCanvasAnchorPair({ previousPair, source, target });
  const second = selectCanvasAnchorPair({ previousPair, source, target });

  assert.deepEqual(first, second);
  assert.deepEqual(source, sourceSnapshot);
  assert.deepEqual(target, targetSnapshot);
  assert.deepEqual(previousPair, previousPairSnapshot);
});

test("anchor pair classification excludes same-side pairs and marks only cross-axis pairs", () => {
  assert.equal(CANVAS_ANCHOR_PAIRS.length, 12);
  assert.equal(
    CANVAS_ANCHOR_PAIRS.some(
      ({ sourceSide, targetSide }) => sourceSide === targetSide
    ),
    false
  );

  assert.equal(
    isCrossAxisAnchorPair({ sourceSide: "top", targetSide: "bottom" }),
    false
  );
  assert.equal(
    isCrossAxisAnchorPair({ sourceSide: "right", targetSide: "left" }),
    false
  );
  assert.equal(
    isCrossAxisAnchorPair({ sourceSide: "right", targetSide: "top" }),
    true
  );
  assert.equal(
    isCrossAxisAnchorPair({ sourceSide: "bottom", targetSide: "left" }),
    true
  );
});

test("canvas node geometry uses measured size before falling back to collapsed CSS size", () => {
  assert.deepEqual(
    canvasNodeGeometryFromNode({
      id: "measured",
      measured: { height: 140, width: 300 },
      position: { x: 16, y: 32 },
    }),
    {
      height: 140,
      width: 300,
      x: 16,
      y: 32,
    }
  );

  assert.deepEqual(
    canvasNodeGeometryFromNode({
      id: "unmeasured",
      position: { x: 48, y: 64 },
    }),
    {
      height: CANVAS_NODE_FALLBACK_HEIGHT,
      width: CANVAS_NODE_FALLBACK_WIDTH,
      x: 48,
      y: 64,
    }
  );
});
