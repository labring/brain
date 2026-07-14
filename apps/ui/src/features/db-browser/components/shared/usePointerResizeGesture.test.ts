import assert from "node:assert/strict";
import { test } from "node:test";

import { createPointerResizeGesture } from "./usePointerResizeGesture";

function fakeAnimationFrames() {
  let nextId = 1;
  const callbacks = new Map<number, () => void>();

  return {
    cancel(id: number) {
      callbacks.delete(id);
    },
    flush() {
      const pending = Array.from(callbacks.values());
      callbacks.clear();
      for (const callback of pending) {
        callback();
      }
    },
    pendingCount() {
      return callbacks.size;
    },
    request(callback: () => void) {
      const id = nextId;
      nextId += 1;
      callbacks.set(id, callback);
      return id;
    },
  };
}

test("pointer resize coalesces previews and commits the final coordinate once", () => {
  const frames = fakeAnimationFrames();
  const previews: number[] = [];
  const commits: number[] = [];
  const gesture = createPointerResizeGesture(frames);

  gesture.start({
    commit: (clientX) => commits.push(clientX),
    preview: (clientX) => previews.push(clientX),
  });
  gesture.move(120);
  gesture.move(140);

  assert.equal(frames.pendingCount(), 1);
  assert.deepEqual(previews, []);

  frames.flush();
  assert.deepEqual(previews, [140]);

  gesture.move(150);
  gesture.finish(160);

  assert.equal(frames.pendingCount(), 0);
  assert.deepEqual(previews, [140, 160]);
  assert.deepEqual(commits, [160]);
});

test("pointer resize cancellation drops pending work without committing", () => {
  const frames = fakeAnimationFrames();
  const previews: number[] = [];
  const commits: number[] = [];
  let cancellations = 0;
  const gesture = createPointerResizeGesture(frames);

  gesture.start({
    cancel: () => {
      cancellations += 1;
    },
    commit: (clientX) => commits.push(clientX),
    preview: (clientX) => previews.push(clientX),
  });
  gesture.move(120);
  gesture.cancel();
  frames.flush();

  assert.deepEqual(previews, []);
  assert.deepEqual(commits, []);
  assert.equal(cancellations, 1);
});
