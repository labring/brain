import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createProjectSidePaneController,
  type ProjectSidePaneAssistantIntent,
} from "./controller";

test("assistant intents are ignored safely when no project surface is registered", async () => {
  const controller = createProjectSidePaneController();

  const result = await controller.openAssistantIntent({ type: "github" });

  assert.deepEqual(result, { status: "ignored" });
});

test("assistant intents are routed only to the current registered project surface", async () => {
  const controller = createProjectSidePaneController();
  const events: string[] = [];
  const githubIntent: ProjectSidePaneAssistantIntent = { type: "github" };

  const unregisterList = controller.registerSurface({
    id: "project-list",
    openAssistantIntent: (intent) => {
      events.push(`list:${intent.type}`);
      return { status: "handled" };
    },
  });

  assert.deepEqual(await controller.openAssistantIntent(githubIntent), {
    status: "handled",
  });

  const unregisterCanvas = controller.registerSurface({
    id: "project-canvas:project-1",
    openAssistantIntent: (intent) => {
      events.push(`canvas:${intent.type}`);
      return { status: "handled" };
    },
  });

  assert.deepEqual(await controller.openAssistantIntent(githubIntent), {
    status: "handled",
  });

  unregisterList();
  assert.deepEqual(await controller.openAssistantIntent(githubIntent), {
    status: "handled",
  });

  unregisterCanvas();
  assert.deepEqual(await controller.openAssistantIntent(githubIntent), {
    status: "ignored",
  });
  assert.deepEqual(events, ["list:github", "canvas:github", "canvas:github"]);
});
