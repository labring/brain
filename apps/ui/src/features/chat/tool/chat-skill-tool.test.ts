import { test } from "bun:test";
import assert from "node:assert/strict";
import type { ChatDevboxSandbox } from "@/features/chat/devbox/chat-runtime";
import {
  createLoadSkillResourceTool,
  createLoadSkillTool,
} from "./chat-skill-tool";

const CANCELLATION_ERROR_RE = /cancelled/;

const skill = {
  description: "Deploy applications.",
  folderName: "sealos-deploy",
  name: "sealos-deploy",
  skillDirectory: "/home/devbox/project/.agents/skills/sealos-deploy",
  skillMdPath: "/home/devbox/project/.agents/skills/sealos-deploy/SKILL.md",
};

function createSandbox(
  readFile: (path: string) => Promise<string>,
  onSignal: (signal: AbortSignal | undefined) => void
): ChatDevboxSandbox {
  return {
    executeCommand: async () => ({ exitCode: 0, stderr: "", stdout: "" }),
    getDevboxName: async () => "chat-runtime",
    readFile,
    runWithAbortSignal: async (signal, operation) => {
      onSignal(signal);
      signal?.throwIfAborted();
      return await operation();
    },
    stop: () => Promise.resolve(),
    writeFiles: () => Promise.resolve(),
  };
}

function getExecute(toolDefinition: unknown) {
  const execute = Reflect.get(toolDefinition as object, "execute");
  assert.equal(typeof execute, "function");
  return execute as (
    input: Record<string, string>,
    options: { abortSignal?: AbortSignal }
  ) => Promise<unknown>;
}

test("Skill reads forward the AI SDK abort signal to the Devbox sandbox", async () => {
  const controller = new AbortController();
  const signals: Array<AbortSignal | undefined> = [];
  const sandbox = createSandbox(
    async (path) =>
      path.endsWith("SKILL.md")
        ? "---\nname: sealos-deploy\n---\n# Deploy"
        : "reference",
    (signal) => signals.push(signal)
  );

  const loadSkill = createLoadSkillTool([skill], sandbox);
  const loadResource = createLoadSkillResourceTool([skill], sandbox);
  await getExecute(loadSkill)(
    { intention: "test skill loading", name: "sealos-deploy" },
    { abortSignal: controller.signal }
  );
  await getExecute(loadResource)(
    {
      intention: "test skill resource loading",
      name: "sealos-deploy",
      path: "references/deploy.md",
    },
    { abortSignal: controller.signal }
  );

  assert.deepEqual(signals, [controller.signal, controller.signal]);
});

test("Skill reads propagate an already-aborted signal", async () => {
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  const sandbox = createSandbox(
    async () => "never read",
    () => undefined
  );
  const loadSkill = createLoadSkillTool([skill], sandbox);

  await assert.rejects(
    getExecute(loadSkill)(
      { intention: "test cancelled skill loading", name: "sealos-deploy" },
      { abortSignal: controller.signal }
    ),
    CANCELLATION_ERROR_RE
  );
});
