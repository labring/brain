import assert from "node:assert/strict";
import { test } from "node:test";

import {
  newProjectTemplateRequest,
  projectCreatorIntegrationState,
} from "./use-project-creator";

test("project creator integrations are disabled while the creation pane is closed", () => {
  assert.deepEqual(
    projectCreatorIntegrationState({ activeSource: "github", open: false }),
    {
      githubEnabled: false,
      templateEnabled: false,
    }
  );
  assert.deepEqual(
    projectCreatorIntegrationState({ activeSource: "template", open: false }),
    {
      githubEnabled: false,
      templateEnabled: false,
    }
  );
});

test("project creator integrations are disabled on the general method picker", () => {
  assert.deepEqual(
    projectCreatorIntegrationState({ activeSource: null, open: true }),
    {
      githubEnabled: false,
      templateEnabled: false,
    }
  );
});

test("project creator enables the selected optional integration", () => {
  assert.deepEqual(
    projectCreatorIntegrationState({ activeSource: "github", open: true }),
    {
      githubEnabled: true,
      templateEnabled: true,
    }
  );
  assert.deepEqual(
    projectCreatorIntegrationState({ activeSource: "template", open: true }),
    {
      githubEnabled: false,
      templateEnabled: true,
    }
  );
  assert.deepEqual(
    projectCreatorIntegrationState({
      activeSource: "docker-image",
      open: true,
    }),
    {
      githubEnabled: false,
      templateEnabled: false,
    }
  );
  assert.deepEqual(
    projectCreatorIntegrationState({ activeSource: "database", open: true }),
    {
      githubEnabled: false,
      templateEnabled: false,
    }
  );
});

test("a new-project template request snapshots the chosen catalog item's categories", () => {
  const settings = {
    args: { port: "8080", token: "secret" },
    sensitiveKeys: ["token"],
    templateName: "eaglercraft-server",
  };
  assert.deepEqual(
    newProjectTemplateRequest(
      settings,
      { category: ["game", "tool"] },
      { description: "My server", kind: "newProject" }
    ),
    {
      args: { port: "8080", token: "secret" },
      kind: "template",
      sensitiveKeys: ["token"],
      target: { description: "My server", kind: "newProject" },
      templateCategories: ["game", "tool"],
      templateName: "eaglercraft-server",
    }
  );
});

test("a new-project template request declares no categories for a catalog item without them", () => {
  const request = newProjectTemplateRequest(
    { args: {}, sensitiveKeys: [], templateName: "memos" },
    {},
    { kind: "newProject" }
  );
  assert.equal(request.templateCategories, undefined);
  assert.equal(request.templateName, "memos");
});
