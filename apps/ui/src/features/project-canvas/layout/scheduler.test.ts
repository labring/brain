import assert from "node:assert/strict";
import { test } from "node:test";
import { createCanvasLayoutNodeSaveScheduler } from "./scheduler";
import type { CanvasLayoutNode } from "./types";

function layoutNode(
  overrides: Partial<CanvasLayoutNode> = {}
): CanvasLayoutNode {
  return {
    expanded: false,
    position: { x: 10, y: 20 },
    ref: { kind: "ap", name: "api", namespace: "default" },
    ...overrides,
  };
}

test("canvas layout scheduler skips unchanged node layouts", async () => {
  const saved: CanvasLayoutNode[][] = [];
  let callback: (() => void | Promise<void>) | undefined;
  const scheduler = createCanvasLayoutNodeSaveScheduler({
    clearTimeout: () => undefined,
    delayMs: 600,
    save: (nodes) => {
      saved.push(nodes);
      return Promise.resolve();
    },
    setTimeout: (nextCallback) => {
      callback = nextCallback;
      return 1;
    },
  });
  const node = layoutNode();

  scheduler.schedule(node);
  scheduler.schedule({ ...node, position: { ...node.position } });
  await callback?.();

  assert.equal(saved.length, 1);
  assert.equal(saved[0]?.length, 1);
});

test("canvas layout scheduler skips unchanged node layouts after flush", async () => {
  const saved: CanvasLayoutNode[][] = [];
  let callback: (() => void | Promise<void>) | undefined;
  const scheduler = createCanvasLayoutNodeSaveScheduler({
    clearTimeout: () => undefined,
    delayMs: 600,
    save: (nodes) => {
      saved.push(nodes);
      return Promise.resolve();
    },
    setTimeout: (nextCallback) => {
      callback = nextCallback;
      return 1;
    },
  });
  const node = layoutNode();

  scheduler.schedule(node);
  await callback?.();
  scheduler.schedule({ ...node, position: { ...node.position } });
  await callback?.();

  assert.equal(saved.length, 1);
});

test("canvas layout scheduler saves changed node layouts after prior flush", async () => {
  const saved: CanvasLayoutNode[][] = [];
  let callback: (() => void | Promise<void>) | undefined;
  const scheduler = createCanvasLayoutNodeSaveScheduler({
    clearTimeout: () => undefined,
    delayMs: 600,
    save: (nodes) => {
      saved.push(nodes);
      return Promise.resolve();
    },
    setTimeout: (nextCallback) => {
      callback = nextCallback;
      return 1;
    },
  });

  scheduler.schedule(layoutNode());
  await callback?.();
  scheduler.schedule(layoutNode({ position: { x: 30, y: 40 } }));
  await callback?.();

  assert.equal(saved.length, 2);
  assert.deepEqual(saved[1]?.[0]?.position, { x: 30, y: 40 });
});
