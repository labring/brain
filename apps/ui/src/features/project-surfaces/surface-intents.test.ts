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

test("Project List translates assistant skills intent to skills workflow side pane", () => {
  assert.deepEqual(projectListEntryForAssistantIntent({ type: "skills" }), {
    kind: "skillsWorkflow",
  });
});

test("Project Canvas translates assistant GitHub intent to deployment in the current Project", () => {
  assert.deepEqual(
    projectCanvasEntryForAssistantIntent(
      { type: "github" },
      { projectId: "project-1" }
    ),
    {
      entry: {
        kind: "githubDeployment",
        projectId: "project-1",
      },
      slot: "side",
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
      entry: {
        kind: "databaseDeployment",
        projectId: "project-1",
      },
      slot: "side",
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
      entry: {
        kind: "dockerDeployment",
        projectId: "project-1",
      },
      slot: "side",
    }
  );
});

test("Project Canvas translates assistant skills intent to skills workflow side pane", () => {
  assert.deepEqual(
    projectCanvasEntryForAssistantIntent(
      { type: "skills" },
      { projectId: "project-1" }
    ),
    {
      entry: {
        kind: "skillsWorkflow",
      },
      slot: "side",
    }
  );
});

test("Project Canvas translates assistant AP settings intent to an AP side surface", () => {
  assert.deepEqual(
    projectCanvasEntryForAssistantIntent({
      target: { kind: "AP", name: "web", namespace: "ns" },
      type: "apSettings",
    }),
    {
      entry: {
        kind: "settings",
        target: { kind: "AP", name: "web", namespace: "ns" },
      },
      slot: "side",
    }
  );
});

test("Project Canvas translates assistant public address intent to an AP-owned settings view", () => {
  assert.deepEqual(
    projectCanvasEntryForAssistantIntent({
      target: { apName: "web", kind: "PublicAccess", namespace: "ns" },
      type: "publicAddresses",
    }),
    {
      entry: {
        kind: "settings",
        target: { kind: "AP", name: "web", namespace: "ns" },
        view: "public-addresses",
      },
      slot: "side",
    }
  );
});

test("Project Canvas translates assistant AP terminal intent to a drawer surface", () => {
  assert.deepEqual(
    projectCanvasEntryForAssistantIntent({
      target: { kind: "AP", name: "web", namespace: "ns" },
      type: "apTerminal",
    }),
    {
      entry: {
        kind: "apTerminal",
        target: { kind: "AP", name: "web", namespace: "ns" },
      },
      slot: "drawer",
    }
  );
});

test("Project Canvas translates assistant DB access intent to a main surface that keeps side visible", () => {
  assert.deepEqual(
    projectCanvasEntryForAssistantIntent({
      target: { kind: "DB", name: "postgres", namespace: "ns" },
      type: "dbAccess",
    }),
    {
      entry: {
        focusPolicy: "keepSideVisible",
        kind: "dbAccess",
        target: { kind: "DB", name: "postgres", namespace: "ns" },
      },
      slot: "main",
    }
  );
});

test("Project Canvas translates assistant logs intent to resource logs", () => {
  assert.deepEqual(
    projectCanvasEntryForAssistantIntent({
      target: { kind: "AP", name: "web", namespace: "ns" },
      type: "logs",
    }),
    {
      entry: {
        focusPolicy: "keepSideVisible",
        kind: "resourceLogs",
        target: { kind: "AP", name: "web", namespace: "ns" },
      },
      slot: "main",
    }
  );
});

test("Project Canvas ignores GitHub deployment without an existing Project context", () => {
  assert.equal(
    projectCanvasEntryForAssistantIntent({ type: "github" }, { projectId: "" }),
    null
  );
});
