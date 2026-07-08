import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type CanvasGlassSnapshot,
  createCanvasGlassStore,
  selectCanvasNodeSelfBlur,
} from "./canvas-glass-store";

function snapshot(
  active: boolean,
  overlapping: string[] = []
): CanvasGlassSnapshot {
  return { active, overlapping: new Set(overlapping) };
}

test("inactive store keeps every node's own blur", () => {
  const store = createCanvasGlassStore();
  assert.equal(store.getNodeSelfBlur("a"), true);
});

test("active sheet drops blur for isolated nodes, keeps it for overlapping", () => {
  const store = createCanvasGlassStore(snapshot(true, ["b"]));
  assert.equal(store.getNodeSelfBlur("a"), false);
  assert.equal(store.getNodeSelfBlur("b"), true);
});

test("selectCanvasNodeSelfBlur matches the active/overlap rule", () => {
  assert.equal(selectCanvasNodeSelfBlur(snapshot(false), "a"), true);
  assert.equal(selectCanvasNodeSelfBlur(snapshot(true), "a"), false);
  assert.equal(selectCanvasNodeSelfBlur(snapshot(true, ["a"]), "a"), true);
});

test("setSnapshot notifies only nodes whose self-blur flips", () => {
  const store = createCanvasGlassStore(snapshot(true, []));
  const calls = { a: 0, b: 0 };
  store.subscribeNode("a", () => {
    calls.a += 1;
  });
  store.subscribeNode("b", () => {
    calls.b += 1;
  });
  // a starts overlapping; b stays isolated.
  store.setSnapshot(snapshot(true, ["a"]));
  assert.equal(calls.a, 1);
  assert.equal(calls.b, 0);
  assert.equal(store.getNodeSelfBlur("a"), true);
  assert.equal(store.getNodeSelfBlur("b"), false);
});

test("a stable overlap set notifies nobody", () => {
  const store = createCanvasGlassStore(snapshot(true, ["a"]));
  let notified = 0;
  store.subscribeNode("a", () => {
    notified += 1;
  });
  store.setSnapshot(snapshot(true, ["a"]));
  assert.equal(notified, 0);
});

test("deactivating the sheet restores blur for a tracked isolated node", () => {
  const store = createCanvasGlassStore(snapshot(true, []));
  let notified = 0;
  store.subscribeNode("a", () => {
    notified += 1;
  });
  assert.equal(store.getNodeSelfBlur("a"), false);
  store.setSnapshot(snapshot(false, []));
  assert.equal(notified, 1);
  assert.equal(store.getNodeSelfBlur("a"), true);
});
