import assert from "node:assert/strict";
import { test } from "node:test";

import { createEffectiveVisibilityTracker } from "./effective-visibility";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const CONFIRM_MS = 30;

function trackerWithFocus(hasFocus: () => boolean) {
  const tracker = createEffectiveVisibilityTracker({
    confirmHiddenMs: CONFIRM_MS,
    hasFocus,
  });
  const emitted: boolean[] = [];
  tracker.subscribe((visible) => emitted.push(visible));
  return { emitted, tracker };
}

test("starts visible and stays visible without sentinel reports", async () => {
  const { emitted, tracker } = trackerWithFocus(() => false);
  assert.equal(tracker.isVisible(), true);
  await sleep(CONFIRM_MS * 2);
  assert.equal(tracker.isVisible(), true);
  assert.deepEqual(emitted, []);
});

test("a not-visible sentinel flips hidden only after the confirm window", async () => {
  const { emitted, tracker } = trackerWithFocus(() => false);

  tracker.reportSentinelVisibility(false);
  assert.equal(tracker.isVisible(), true);
  await sleep(CONFIRM_MS / 3);
  assert.equal(tracker.isVisible(), true);

  await sleep(CONFIRM_MS * 2);
  assert.equal(tracker.isVisible(), false);
  assert.deepEqual(emitted, [false]);
});

test("a focused document postpones the hidden flip until focus is lost", async () => {
  let focused = true;
  const { tracker } = trackerWithFocus(() => focused);

  tracker.reportSentinelVisibility(false);
  await sleep(CONFIRM_MS * 2);
  assert.equal(tracker.isVisible(), true);

  // Focus leaves; the re-armed confirm window now completes.
  focused = false;
  await sleep(CONFIRM_MS * 2);
  assert.equal(tracker.isVisible(), false);
});

test("a visible sentinel report resumes immediately", async () => {
  const { emitted, tracker } = trackerWithFocus(() => false);

  tracker.reportSentinelVisibility(false);
  await sleep(CONFIRM_MS * 2);
  assert.equal(tracker.isVisible(), false);

  tracker.reportSentinelVisibility(true);
  assert.equal(tracker.isVisible(), true);
  assert.deepEqual(emitted, [false, true]);
});

test("interaction resumes immediately and restarts the confirm window", async () => {
  const { tracker } = trackerWithFocus(() => false);

  tracker.reportSentinelVisibility(false);
  await sleep(CONFIRM_MS * 2);
  assert.equal(tracker.isVisible(), false);

  tracker.reportInteraction();
  assert.equal(tracker.isVisible(), true);

  // Sentinel state is still not-visible, so with no further interaction the
  // tracker re-confirms hidden one window later.
  await sleep(CONFIRM_MS * 2);
  assert.equal(tracker.isVisible(), false);
});

test("interaction keeps a spuriously occluded app visible", async () => {
  const { tracker } = trackerWithFocus(() => false);

  tracker.reportSentinelVisibility(false);
  for (let i = 0; i < 4; i += 1) {
    await sleep(CONFIRM_MS / 3);
    tracker.reportInteraction();
    assert.equal(tracker.isVisible(), true);
  }
});

test("tab visibility folds into the effective state without duplicate emits", async () => {
  const { emitted, tracker } = trackerWithFocus(() => false);

  tracker.setTabVisible(false);
  assert.equal(tracker.isVisible(), false);
  tracker.setTabVisible(true);
  assert.equal(tracker.isVisible(), true);
  assert.deepEqual(emitted, [false, true]);

  // Already embedded-hidden: tab flips must not re-emit an unchanged state.
  tracker.reportSentinelVisibility(false);
  await sleep(CONFIRM_MS * 2);
  assert.deepEqual(emitted, [false, true, false]);
  tracker.setTabVisible(false);
  tracker.setTabVisible(true);
  assert.deepEqual(emitted, [false, true, false]);
});

test("unsubscribe stops notifications", async () => {
  const tracker = createEffectiveVisibilityTracker({
    confirmHiddenMs: CONFIRM_MS,
    hasFocus: () => false,
  });
  const emitted: boolean[] = [];
  const unsubscribe = tracker.subscribe((visible) => emitted.push(visible));
  unsubscribe();

  tracker.reportSentinelVisibility(false);
  await sleep(CONFIRM_MS * 2);
  assert.equal(tracker.isVisible(), false);
  assert.deepEqual(emitted, []);
});
