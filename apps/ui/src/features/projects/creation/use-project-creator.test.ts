import assert from "node:assert/strict";
import { test } from "node:test";

import { projectCreatorIntegrationState } from "./use-project-creator";

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
