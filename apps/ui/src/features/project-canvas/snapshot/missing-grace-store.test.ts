import assert from "node:assert/strict";
import { test } from "node:test";
import { CANVAS_MISSING_RESOURCE_LAYOUT_GRACE_MS } from "../layout/missing-resource-grace";
import { canvasLayoutNodeKey } from "../layout/placement-owner";
import type { CanvasLayoutDocument, CanvasLayoutNode } from "../layout/types";
import { createMissingResourceGraceStore } from "./missing-grace-store";

const T0_MS = Date.parse("2026-06-11T10:01:00.000Z");

function missingDbNode(): CanvasLayoutNode {
  return {
    owner: {
      kind: "resource",
      ref: { kind: "DB", name: "postgres", namespace: "default" },
    },
    position: { x: 0, y: 0 },
  };
}

function layoutWith(nodes: CanvasLayoutNode[]): CanvasLayoutDocument {
  return {
    namespace: "default",
    nodes,
    projectId: "project-uid",
    version: 1,
  };
}

function withClock(run: (setNow: (ms: number) => void) => void): void {
  const realNow = Date.now;
  let currentMs = T0_MS;
  Date.now = () => currentMs;
  try {
    run((ms) => {
      currentMs = ms;
    });
  } finally {
    Date.now = realNow;
  }
}

test("grace store retains a missing resource and stamps missing-since once", () => {
  withClock((setNow) => {
    const store = createMissingResourceGraceStore();
    try {
      const node = missingDbNode();
      const ownerKey = canvasLayoutNodeKey(node);
      store.commit({
        layout: layoutWith([node]),
        ready: true,
        resourceIdentities: [],
      });
      const first = store.getSnapshot();
      assert.equal(first.nowMs, T0_MS);
      assert.equal(first.retainedLayoutOwnerKeys.has(ownerKey), true);
      assert.deepEqual(first.deleteCommands, []);

      // A later commit inside the window keeps the original missing-since
      // stamp, so the grace window does not restart.
      setNow(T0_MS + CANVAS_MISSING_RESOURCE_LAYOUT_GRACE_MS - 1000);
      store.commit({
        layout: layoutWith([node]),
        ready: true,
        resourceIdentities: [],
      });
      assert.equal(
        store.getSnapshot().retainedLayoutOwnerKeys.has(ownerKey),
        true
      );

      setNow(T0_MS + CANVAS_MISSING_RESOURCE_LAYOUT_GRACE_MS + 1);
      store.commit({
        layout: layoutWith([node]),
        ready: true,
        resourceIdentities: [],
      });
      const expired = store.getSnapshot();
      assert.equal(expired.retainedLayoutOwnerKeys.size, 0);
      assert.equal(expired.deleteCommands.length, 1);
      assert.equal(expired.deleteCommands[0]?.kind, "delete");
    } finally {
      store.dispose();
    }
  });
});

test("grace store leaves present resources alone", () => {
  withClock(() => {
    const store = createMissingResourceGraceStore();
    try {
      const node = missingDbNode();
      store.commit({
        layout: layoutWith([node]),
        ready: true,
        resourceIdentities: [
          { kind: "DB", name: "postgres", namespace: "default" },
        ],
      });
      const snapshot = store.getSnapshot();
      assert.equal(snapshot.retainedLayoutOwnerKeys.size, 0);
      assert.deepEqual(snapshot.deleteCommands, []);
    } finally {
      store.dispose();
    }
  });
});

test("grace store survives not-ready commits without restarting the window", () => {
  withClock((setNow) => {
    const store = createMissingResourceGraceStore();
    try {
      const node = missingDbNode();
      const ownerKey = canvasLayoutNodeKey(node);
      store.commit({
        layout: layoutWith([node]),
        ready: true,
        resourceIdentities: [],
      });
      assert.equal(
        store.getSnapshot().retainedLayoutOwnerKeys.has(ownerKey),
        true
      );

      // Transient reload: lists refetching publishes an empty result but
      // must not forget when the resource first went missing.
      store.commit({ layout: undefined, ready: false, resourceIdentities: [] });
      assert.equal(store.getSnapshot().retainedLayoutOwnerKeys.size, 0);

      setNow(T0_MS + CANVAS_MISSING_RESOURCE_LAYOUT_GRACE_MS + 1);
      store.commit({
        layout: layoutWith([node]),
        ready: true,
        resourceIdentities: [],
      });
      assert.equal(store.getSnapshot().deleteCommands.length, 1);
    } finally {
      store.dispose();
    }
  });
});

test("grace store notifies subscribers on commits that change the result", () => {
  withClock(() => {
    const store = createMissingResourceGraceStore();
    try {
      let notified = 0;
      const unsubscribe = store.subscribe(() => {
        notified += 1;
      });
      store.commit({
        layout: layoutWith([missingDbNode()]),
        ready: true,
        resourceIdentities: [],
      });
      assert.equal(notified, 1);
      unsubscribe();
      store.commit({
        layout: layoutWith([missingDbNode()]),
        ready: true,
        resourceIdentities: [],
      });
      assert.equal(notified, 1);
    } finally {
      store.dispose();
    }
  });
});
