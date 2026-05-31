import assert from "node:assert/strict";
import { test } from "node:test";

import {
  continueSidePaneLeave,
  type SidePaneLeaveGuard,
  shouldPromptSidePaneLeave,
} from "./leave-guard";

function dirtyGuard(
  events: string[],
  options?: {
    canSave?: boolean;
    save?: () => Promise<void> | void;
  }
): SidePaneLeaveGuard {
  return {
    canSave: options?.canSave,
    dirty: true,
    discard: () => {
      events.push("discard");
    },
    save:
      options?.save ??
      (() => {
        events.push("save");
      }),
  };
}

test("dirty side pane replacement can stay, discard, or save before continuing", async () => {
  const events: string[] = [];
  const guard = dirtyGuard(events);
  let replacements = 0;

  assert.equal(shouldPromptSidePaneLeave(guard), true);

  const stayed = await continueSidePaneLeave({
    decision: "stay",
    guard,
    onContinue: () => {
      replacements += 1;
    },
  });
  assert.equal(stayed.status, "stayed");
  assert.equal(replacements, 0);
  assert.deepEqual(events, []);

  const discarded = await continueSidePaneLeave({
    decision: "discard",
    guard,
    onContinue: () => {
      replacements += 1;
    },
  });
  assert.equal(discarded.status, "continued");
  assert.equal(replacements, 1);
  assert.deepEqual(events, ["discard"]);

  const saved = await continueSidePaneLeave({
    decision: "save",
    guard,
    onContinue: () => {
      replacements += 1;
    },
  });
  assert.equal(saved.status, "continued");
  assert.equal(replacements, 2);
  assert.deepEqual(events, ["discard", "save"]);
});

test("dirty side pane replacement stays active when save fails", async () => {
  const events: string[] = [];
  const guard = dirtyGuard(events, {
    save: () => {
      events.push("save");
      throw new Error("save failed");
    },
  });
  let replaced = false;

  const result = await continueSidePaneLeave({
    decision: "save",
    guard,
    onContinue: () => {
      replaced = true;
    },
  });

  assert.equal(result.status, "blocked");
  assert.equal(replaced, false);
  assert.deepEqual(events, ["save"]);
});

test("dirty side pane replacement blocks save when the guard cannot save", async () => {
  const events: string[] = [];
  const guard = dirtyGuard(events, { canSave: false });
  let replaced = false;

  const result = await continueSidePaneLeave({
    decision: "save",
    guard,
    onContinue: () => {
      replaced = true;
    },
  });

  assert.equal(result.status, "blocked");
  assert.equal(replaced, false);
  assert.deepEqual(events, []);
});
