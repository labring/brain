import assert from "node:assert/strict";
import { test } from "node:test";

import {
  OPEN_PROJECT_SURFACE_TOOL_NAME,
  runOpenProjectSurfaceTool,
} from "./chat-open-project-surface-tool";

test("open project surface tool routes typed AP terminal intents through the surface router", async () => {
  const received: unknown[] = [];

  const result = await runOpenProjectSurfaceTool(
    {
      intention: "inspect the running AP container",
      target: { kind: "AP", name: "web", namespace: "ns" },
      type: "apTerminal",
    },
    {
      openAssistantIntent: (intent) => {
        received.push(intent);
        return Promise.resolve({ status: "handled" });
      },
    }
  );

  assert.equal(OPEN_PROJECT_SURFACE_TOOL_NAME, "openProjectSurface");
  assert.deepEqual(result, { ok: true, status: "handled" });
  assert.deepEqual(received, [
    {
      target: { kind: "AP", name: "web", namespace: "ns" },
      type: "apTerminal",
    },
  ]);
});

test("open project surface tool rejects empty resource target names before routing", async () => {
  const result = await runOpenProjectSurfaceTool(
    {
      intention: "open settings",
      target: { kind: "AP", name: " ", namespace: "ns" },
      type: "apSettings",
    },
    {
      openAssistantIntent: () => {
        throw new Error("router should not be called");
      },
    }
  );

  assert.equal(result.ok, false);
});

test("open project surface tool rejects target kinds that do not match the requested surface", async () => {
  const result = await runOpenProjectSurfaceTool(
    {
      intention: "open db access",
      target: { kind: "AP", name: "web", namespace: "ns" },
      type: "dbAccess",
    },
    {
      openAssistantIntent: () => {
        throw new Error("router should not be called");
      },
    }
  );

  assert.deepEqual(result, {
    error: "dbAccess requires a DB target.",
    ok: false,
  });
});
