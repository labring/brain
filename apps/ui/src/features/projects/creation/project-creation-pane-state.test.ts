import assert from "node:assert/strict";
import { test } from "node:test";

import {
  initialProjectCreationPaneState,
  projectCreationPaneStateReducer,
} from "./project-creation-pane-state";

test("project creation pane open events reset the creator flow", () => {
  const firstOpen = projectCreationPaneStateReducer(
    initialProjectCreationPaneState,
    { type: "open" }
  );

  assert.equal(firstOpen.open, true);
  assert.equal(firstOpen.entryMode, "general");
  assert.equal(firstOpen.resetKey, 1);

  const reopenWhileOpen = projectCreationPaneStateReducer(firstOpen, {
    type: "open",
  });

  assert.equal(reopenWhileOpen.open, true);
  assert.equal(reopenWhileOpen.entryMode, "general");
  assert.equal(reopenWhileOpen.resetKey, 2);
});

test("project creation pane can open directly into GitHub creation", () => {
  const directOpen = projectCreationPaneStateReducer(
    initialProjectCreationPaneState,
    { entryMode: "githubDirect", type: "open" }
  );

  assert.equal(directOpen.open, true);
  assert.equal(directOpen.entryMode, "githubDirect");
  assert.equal(directOpen.resetKey, 1);

  const generalOpen = projectCreationPaneStateReducer(directOpen, {
    type: "open",
  });

  assert.equal(generalOpen.open, true);
  assert.equal(generalOpen.entryMode, "general");
  assert.equal(generalOpen.resetKey, 2);
});

test("project creation pane can open directly into database creation", () => {
  const directOpen = projectCreationPaneStateReducer(
    initialProjectCreationPaneState,
    { entryMode: "databaseDirect", type: "open" }
  );

  assert.equal(directOpen.open, true);
  assert.equal(directOpen.entryMode, "databaseDirect");
  assert.equal(directOpen.resetKey, 1);
});

test("project creation pane can open directly into Docker creation", () => {
  const directOpen = projectCreationPaneStateReducer(
    initialProjectCreationPaneState,
    { entryMode: "dockerDirect", type: "open" }
  );

  assert.equal(directOpen.open, true);
  assert.equal(directOpen.entryMode, "dockerDirect");
  assert.equal(directOpen.resetKey, 1);
});

test("project creation pane can open directly into template creation", () => {
  const directOpen = projectCreationPaneStateReducer(
    initialProjectCreationPaneState,
    { entryMode: "templateDirect", type: "open" }
  );

  assert.equal(directOpen.open, true);
  assert.equal(directOpen.entryMode, "templateDirect");
  assert.equal(directOpen.resetKey, 1);
  assert.equal(directOpen.templateName, undefined);

  const prefilledOpen = projectCreationPaneStateReducer(directOpen, {
    entryMode: "templateDirect",
    templateArgs: { port: "3000" },
    templateName: "flowise",
    type: "open",
  });
  assert.equal(prefilledOpen.templateName, "flowise");
  assert.deepEqual(prefilledOpen.templateArgs, { port: "3000" });
  assert.equal(prefilledOpen.resetKey, 2);
});

test("project creation pane close hides the pane without mutating the next reset key", () => {
  const open = projectCreationPaneStateReducer(
    initialProjectCreationPaneState,
    { type: "open" }
  );
  const closed = projectCreationPaneStateReducer(open, { type: "close" });

  assert.equal(closed.open, false);
  assert.equal(closed.entryMode, "general");
  assert.equal(closed.resetKey, open.resetKey);

  const reopened = projectCreationPaneStateReducer(closed, { type: "open" });

  assert.equal(reopened.open, true);
  assert.equal(reopened.resetKey, open.resetKey + 1);
});
