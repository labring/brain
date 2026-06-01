import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createProjectSidePaneAssistantRouter,
  type ProjectSidePaneAssistantIntent,
} from "./assistant-router";

test("assistant intents are ignored safely when no project surface is registered", async () => {
  const router = createProjectSidePaneAssistantRouter();

  const result = await router.openAssistantIntent({ type: "github" });

  assert.deepEqual(result, { status: "ignored" });
});

test("assistant intents are routed only to the current registered project surface", async () => {
  const router = createProjectSidePaneAssistantRouter();
  const events: string[] = [];
  const githubIntent: ProjectSidePaneAssistantIntent = { type: "github" };

  const unregisterList = router.registerSurface({
    id: "project-list",
    openAssistantIntent: (intent) => {
      events.push(`list:${intent.type}`);
      return { status: "handled" };
    },
  });

  assert.deepEqual(await router.openAssistantIntent(githubIntent), {
    status: "handled",
  });

  const unregisterCanvas = router.registerSurface({
    id: "project-canvas:project-1",
    openAssistantIntent: (intent) => {
      events.push(`canvas:${intent.type}`);
      return { status: "handled" };
    },
  });

  assert.deepEqual(await router.openAssistantIntent(githubIntent), {
    status: "handled",
  });

  unregisterList();
  assert.deepEqual(await router.openAssistantIntent(githubIntent), {
    status: "handled",
  });

  unregisterCanvas();
  assert.deepEqual(await router.openAssistantIntent(githubIntent), {
    status: "ignored",
  });
  assert.deepEqual(events, ["list:github", "canvas:github", "canvas:github"]);
});
