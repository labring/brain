import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  continueSettingsLeave,
  SettingsLeaveGuardDialogContent,
  type SettingsLeaveGuardHandle,
  shouldPromptSettingsLeave,
} from "./settings-leave-guard";

const UNSAVED_DATABASE_CONFIGURATION_RE =
  /Unsaved database configuration changes/;
const UNSAVED_PUBLIC_ADDRESS_RE = /Unsaved Public Address changes/;
const SAVE_BUTTON_RE = />Save</;
const DISCARD_BUTTON_RE = />Discard</;
const STAY_BUTTON_RE = />Stay</;

function dirtyGuard(
  scope: SettingsLeaveGuardHandle["scope"],
  events: string[],
  options?: {
    canSave?: boolean;
    save?: () => Promise<void> | void;
  }
): SettingsLeaveGuardHandle {
  return {
    canSave: options?.canSave,
    dirty: true,
    discard: () => {
      events.push(`${scope}:discard`);
    },
    save:
      options?.save ??
      (() => {
        events.push(`${scope}:save`);
      }),
    scope,
  };
}

test("dirty AP Settings close can stay, discard, or save before closing", async () => {
  const events: string[] = [];
  const guard = dirtyGuard("ap", events);
  let closed = 0;

  assert.equal(shouldPromptSettingsLeave(guard), true);

  const stayed = await continueSettingsLeave({
    decision: "stay",
    guard,
    onContinue: () => {
      closed += 1;
    },
  });
  assert.equal(stayed.status, "stayed");
  assert.equal(closed, 0);
  assert.deepEqual(events, []);

  const discarded = await continueSettingsLeave({
    decision: "discard",
    guard,
    onContinue: () => {
      closed += 1;
    },
  });
  assert.equal(discarded.status, "continued");
  assert.equal(closed, 1);
  assert.deepEqual(events, ["ap:discard"]);

  const saved = await continueSettingsLeave({
    decision: "save",
    guard,
    onContinue: () => {
      closed += 1;
    },
  });
  assert.equal(saved.status, "continued");
  assert.equal(closed, 2);
  assert.deepEqual(events, ["ap:discard", "ap:save"]);
});

test("dirty AP Settings resource switch stays put when save fails", async () => {
  const events: string[] = [];
  const guard = dirtyGuard("ap", events, {
    save: () => {
      events.push("ap:save");
      throw new Error("save failed");
    },
  });
  let switched = false;

  const result = await continueSettingsLeave({
    decision: "save",
    guard,
    onContinue: () => {
      switched = true;
    },
  });

  assert.equal(result.status, "blocked");
  assert.equal(switched, false);
  assert.deepEqual(events, ["ap:save"]);
});

test("dirty database configuration close can discard the draft and close", async () => {
  const events: string[] = [];
  const guard = dirtyGuard("database", events);
  let closed = false;

  const result = await continueSettingsLeave({
    decision: "discard",
    guard,
    onContinue: () => {
      closed = true;
    },
  });

  assert.equal(result.status, "continued");
  assert.equal(closed, true);
  assert.deepEqual(events, ["database:discard"]);
});

test("dirty database configuration resource switch can stay with draft intact", async () => {
  const events: string[] = [];
  const guard = dirtyGuard("database", events);
  let switched = false;

  const result = await continueSettingsLeave({
    decision: "stay",
    guard,
    onContinue: () => {
      switched = true;
    },
  });

  assert.equal(result.status, "stayed");
  assert.equal(switched, false);
  assert.deepEqual(events, []);
});

test("settings leave guard dialog offers Save, Discard, and Stay", () => {
  const html = renderToStaticMarkup(
    <SettingsLeaveGuardDialogContent
      action="switch"
      guard={dirtyGuard("database", [])}
      onDecision={() => {
        /* noop */
      }}
      pending={false}
    />
  );

  assert.match(html, UNSAVED_DATABASE_CONFIGURATION_RE);
  assert.match(html, SAVE_BUTTON_RE);
  assert.match(html, DISCARD_BUTTON_RE);
  assert.match(html, STAY_BUTTON_RE);
});

test("settings leave guard dialog names Public Address drafts", () => {
  const html = renderToStaticMarkup(
    <SettingsLeaveGuardDialogContent
      action="switch"
      guard={dirtyGuard("publicAddresses", [])}
      onDecision={() => {
        /* noop */
      }}
      pending={false}
    />
  );

  assert.match(html, UNSAVED_PUBLIC_ADDRESS_RE);
});
