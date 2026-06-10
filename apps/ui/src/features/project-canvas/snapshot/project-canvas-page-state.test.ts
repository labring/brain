import assert from "node:assert/strict";
import { test } from "node:test";

import { projectCanvasFrameState } from "./project-canvas-page-state";

test("project canvas still renders when workload list requests fail", () => {
  const state = projectCanvasFrameState({
    edgeCount: 0,
    error: new Error("database list failed"),
    isEmptyGraphLoading: false,
    kubeconfig: "apiVersion: v1",
    nodeCount: 0,
  });

  assert.equal(state.renderCanvas, true);
  assert.equal(state.overlay, "error");
});

test("project canvas waits only for credentials before rendering", () => {
  const state = projectCanvasFrameState({
    edgeCount: 0,
    error: new Error("database list failed"),
    isEmptyGraphLoading: false,
    kubeconfig: "",
    nodeCount: 0,
  });

  assert.equal(state.renderCanvas, false);
  assert.equal(state.overlay, "none");
});
