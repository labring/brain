import assert from "node:assert/strict";
import { test } from "node:test";

import type { Node } from "@xyflow/react";

import { mergeNodes } from "./canvas.node-merge";

function generatedNode(
  id: string,
  position: Node["position"],
  generatedPosition = position
): Node {
  return {
    data: {
      layout: {
        generatedPosition,
        positionSource: "generated",
      },
    },
    id,
    position,
  };
}

test("mergeNodes updates an untouched generated node to its latest generated position", () => {
  const [node] = mergeNodes(
    [generatedNode("entry-api", { x: 0, y: 0 })],
    [generatedNode("entry-api", { x: -340, y: 0 })]
  );

  assert.deepEqual(node?.position, { x: -340, y: 0 });
});

test("mergeNodes preserves a generated node after the user has moved it", () => {
  const [node] = mergeNodes(
    [generatedNode("entry-api", { x: 24, y: 32 }, { x: 0, y: 0 })],
    [generatedNode("entry-api", { x: -340, y: 0 })]
  );

  assert.deepEqual(node?.position, { x: 24, y: 32 });
});

test("mergeNodes keeps the current nodes when incoming nodes are already represented", () => {
  const incoming = generatedNode("entry-api", { x: 0, y: 0 });
  const current = [{ ...incoming, measured: { height: 64, width: 272 } }];

  const nodes = mergeNodes(current, [incoming]);

  assert.equal(nodes, current);
  assert.equal(nodes[0], current[0]);
});

function shellNode(id: string, runtime: Record<string, unknown>): Node {
  return {
    data: { runtime },
    id,
    position: { x: 0, y: 0 },
    type: "container",
  };
}

test("mergeNodes preserves node identity when incoming data is a fresh but value-equal object", () => {
  const runtime = {
    kind: "AP",
    modelKey: "AP:ns:api",
    resourceRef: { kind: "AP", name: "api", namespace: "ns" },
  };
  const prev = [shellNode("ap-api", { ...runtime })];
  const next = [shellNode("ap-api", { ...runtime })];

  const merged = mergeNodes(prev, next);

  assert.equal(merged, prev);
  assert.equal(merged[0], prev[0]);
});

test("mergeNodes gives a node a new identity when observedUid changes", () => {
  const runtime = { kind: "AP", modelKey: "AP:ns:api" };
  const prev = [shellNode("ap-api", { ...runtime, observedUid: "uid-1" })];
  const next = [shellNode("ap-api", { ...runtime, observedUid: "uid-2" })];

  const [merged] = mergeNodes(prev, next);

  assert.notEqual(merged, prev[0]);
  assert.equal(
    (merged?.data as { runtime: { observedUid: string } }).runtime.observedUid,
    "uid-2"
  );
});

test("mergeNodes keeps a user-expanded node when a value-equal tick arrives collapsed", () => {
  const prev: Node[] = [
    {
      data: {
        layout: { expanded: true },
        runtime: { kind: "AP", modelKey: "AP:ns:api" },
      },
      id: "ap-api",
      position: { x: 0, y: 0 },
      type: "container",
    },
  ];
  const next: Node[] = [
    {
      data: {
        layout: { expanded: false },
        runtime: { kind: "AP", modelKey: "AP:ns:api" },
      },
      id: "ap-api",
      position: { x: 0, y: 0 },
      type: "container",
    },
  ];

  const [merged] = mergeNodes(prev, next);

  assert.equal(merged, prev[0]);
});

test("mergeNodes deep-compares array-bearing placeholder data", () => {
  const placeholder = (targets: string[]): Node => ({
    data: {
      runtime: { kind: "PublicAccess" },
      targets: targets.map((id) => ({ id })),
    },
    id: "entry-api",
    position: { x: 0, y: 0 },
    type: "entry",
  });
  const prev = [placeholder(["a", "b"])];

  assert.equal(mergeNodes(prev, [placeholder(["a", "b"])])[0], prev[0]);
  assert.notEqual(mergeNodes(prev, [placeholder(["a", "c"])])[0], prev[0]);
});
