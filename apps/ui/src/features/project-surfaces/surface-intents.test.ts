import assert from "node:assert/strict";
import { test } from "node:test";

import {
  projectCanvasEntryForAssistantIntent,
  projectListEntryForAssistantIntent,
} from "./surface-intents";

test("Project List translates assistant GitHub intent to GitHub direct project creation", () => {
  assert.deepEqual(projectListEntryForAssistantIntent({ type: "github" }), {
    entryMode: "githubDirect",
    kind: "projectCreation",
  });
});

test("Project List translates assistant database intent to database direct project creation", () => {
  assert.deepEqual(projectListEntryForAssistantIntent({ type: "database" }), {
    entryMode: "databaseDirect",
    kind: "projectCreation",
  });
});

test("Project List translates assistant Docker intent to Docker direct project creation", () => {
  assert.deepEqual(projectListEntryForAssistantIntent({ type: "docker" }), {
    entryMode: "dockerDirect",
    kind: "projectCreation",
  });
});

test("Project Canvas translates assistant GitHub intent to deployment in the current Project", () => {
  assert.deepEqual(
    projectCanvasEntryForAssistantIntent(
      { type: "github" },
      { projectId: "project-1" }
    ),
    {
      kind: "githubDeployment",
      projectId: "project-1",
    }
  );
});

test("Project Canvas translates assistant database intent to deployment in the current Project", () => {
  assert.deepEqual(
    projectCanvasEntryForAssistantIntent(
      { type: "database" },
      { projectId: "project-1" }
    ),
    {
      kind: "databaseDeployment",
      projectId: "project-1",
    }
  );
});

test("Project Canvas translates assistant Docker intent to deployment in the current Project", () => {
  assert.deepEqual(
    projectCanvasEntryForAssistantIntent(
      { type: "docker" },
      { projectId: "project-1" }
    ),
    {
      kind: "dockerDeployment",
      projectId: "project-1",
    }
  );
});

test("Project Canvas ignores GitHub deployment without an existing Project context", () => {
  assert.equal(
    projectCanvasEntryForAssistantIntent({ type: "github" }, { projectId: "" }),
    null
  );
});
