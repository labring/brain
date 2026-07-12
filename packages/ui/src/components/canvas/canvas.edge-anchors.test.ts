import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveCanvasEdgeAnchors } from "./canvas.edge-anchors";

test("canvas edge anchors assign source and target handles through the resolver", () => {
  const result = resolveCanvasEdgeAnchors({
    dragging: false,
    edges: [{ id: "edge-1", source: "source", target: "target" }],
    nodes: [
      { data: {}, id: "source", position: { x: 0, y: 0 } },
      { data: {}, id: "target", position: { x: 320, y: 0 } },
    ],
    previousPairs: new Map(),
    resolver: () => ({
      sourceSide: "right",
      targetSide: "left",
    }),
  });

  assert.deepEqual(result.edges, [
    {
      id: "edge-1",
      source: "source",
      sourceHandle: "right",
      target: "target",
      targetHandle: "left",
    },
  ]);
  assert.deepEqual(result.anchorPairs.get("edge-1"), {
    sourceSide: "right",
    targetSide: "left",
  });
});

test("canvas edge anchors keep edge and array identity when anchors are unchanged", () => {
  const edges = [
    {
      id: "edge-1",
      source: "source",
      sourceHandle: "right",
      target: "target",
      targetHandle: "left",
    },
  ];
  const result = resolveCanvasEdgeAnchors({
    dragging: false,
    edges,
    nodes: [
      { data: {}, id: "source", position: { x: 0, y: 0 } },
      { data: {}, id: "target", position: { x: 320, y: 0 } },
    ],
    previousPairs: new Map(),
    resolver: () => ({
      sourceSide: "right",
      targetSide: "left",
    }),
  });

  assert.equal(result.edges, edges);
  assert.equal(result.edges[0], edges[0]);
});

test("canvas edge anchors reuse unchanged edges while replacing changed ones", () => {
  const edges = [
    {
      id: "edge-1",
      source: "source",
      sourceHandle: "right",
      target: "target",
      targetHandle: "left",
    },
    {
      id: "edge-2",
      source: "target",
      sourceHandle: "bottom",
      target: "source",
      targetHandle: "top",
    },
  ];
  const result = resolveCanvasEdgeAnchors({
    dragging: false,
    edges,
    nodes: [
      { data: {}, id: "source", position: { x: 0, y: 0 } },
      { data: {}, id: "target", position: { x: 320, y: 0 } },
    ],
    previousPairs: new Map(),
    resolver: () => ({
      sourceSide: "right",
      targetSide: "left",
    }),
  });

  assert.notEqual(result.edges, edges);
  assert.equal(result.edges[0], edges[0]);
  assert.notEqual(result.edges[1], edges[1]);
  assert.deepEqual(result.edges[1], {
    id: "edge-2",
    source: "target",
    sourceHandle: "right",
    target: "source",
    targetHandle: "left",
  });
});

test("canvas edge anchors skip unresolved edges and clean stale previous pairs", () => {
  const result = resolveCanvasEdgeAnchors({
    dragging: true,
    edges: [{ id: "missing-target", source: "source", target: "missing" }],
    nodes: [{ data: {}, id: "source", position: { x: 0, y: 0 } }],
    previousPairs: new Map([
      [
        "stale",
        {
          sourceSide: "top",
          targetSide: "bottom",
        },
      ],
    ]),
    resolver: () => ({
      sourceSide: "right",
      targetSide: "left",
    }),
  });

  assert.deepEqual(result.edges, []);
  assert.equal(result.anchorPairs.size, 0);
});
