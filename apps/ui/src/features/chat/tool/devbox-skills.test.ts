import { test } from "bun:test";
import assert from "node:assert/strict";
import { spawn } from "bun";
import type { ChatDevboxSandbox } from "@/features/chat/devbox/chat-runtime";
import {
  discoverChatDevboxSkills,
  resolveChatSkillResourcePath,
} from "./devbox-skills";

const MISSING_FILE_ERROR_PREFIX = "missing test file: ";

function createSandbox(files: Record<string, string>): ChatDevboxSandbox {
  return {
    executeCommand: async () => ({
      exitCode: 0,
      stderr: "",
      stdout: Object.keys(files).join("\n"),
    }),
    getDevboxName: async () => "chat-runtime",
    readFile: (filePath: string) => {
      const content = files[filePath];
      if (content == null) {
        throw new Error(`${MISSING_FILE_ERROR_PREFIX}${filePath}`);
      }
      return Promise.resolve(content);
    },
    runWithAbortSignal: async (_signal, operation) => await operation(),
    stop: () => Promise.resolve(),
    writeFiles: () => Promise.resolve(),
  };
}

function createLocalBashSandbox(): ChatDevboxSandbox {
  return {
    executeCommand: async (command) => {
      const child = spawn(["bash", "-c", command], {
        stderr: "pipe",
        stdout: "pipe",
      });
      const [exitCode, stderr, stdout] = await Promise.all([
        child.exited,
        new Response(child.stderr).text(),
        new Response(child.stdout).text(),
      ]);
      return { exitCode, stderr, stdout };
    },
    getDevboxName: async () => "chat-runtime",
    readFile: () => Promise.reject(new Error("unexpected Skill file read")),
    runWithAbortSignal: async (_signal, operation) => await operation(),
    stop: () => Promise.resolve(),
    writeFiles: () => Promise.resolve(),
  };
}

test("Skill discovery emits valid Bash", async () => {
  await assert.doesNotReject(
    discoverChatDevboxSkills(createLocalBashSandbox())
  );
});

test("discovers user-facing Skills from both supported Devbox roots", async () => {
  const deployPath =
    "/home/devbox/project/.agents/skills/sealos-deploy/SKILL.md";
  const databasePath =
    "/home/devbox/project/.codex/skills/sealos-database/SKILL.md";
  const internalPath =
    "/home/devbox/project/.agents/skills/k8s-kaniko-job/SKILL.md";
  const sandbox = createSandbox({
    [deployPath]:
      "---\nname: sealos-deploy\ndescription: Deploy apps.\n---\n# Deploy",
    [databasePath]:
      "---\nname: sealos-database\ndescription: Manage databases.\n---\n# Database",
    [internalPath]:
      "---\nname: k8s-kaniko-job\ndescription: Internal build executor.\n---\n# Internal",
  });

  const skills = await discoverChatDevboxSkills(sandbox);

  assert.deepEqual(
    skills.map((skill) => skill.name),
    ["sealos-database", "sealos-deploy"]
  );
  assert.equal(
    skills[0]?.skillDirectory,
    "/home/devbox/project/.codex/skills/sealos-database"
  );
});

test("skill resource resolution rejects traversal and absolute paths", () => {
  const skill = {
    description: "Deploy apps.",
    folderName: "sealos-deploy",
    name: "sealos-deploy",
    skillDirectory: "/home/devbox/project/.agents/skills/sealos-deploy",
    skillMdPath: "/home/devbox/project/.agents/skills/sealos-deploy/SKILL.md",
  };

  assert.equal(
    resolveChatSkillResourcePath(skill, "references/deploy-contract.md"),
    "/home/devbox/project/.agents/skills/sealos-deploy/references/deploy-contract.md"
  );
  assert.equal(resolveChatSkillResourcePath(skill, "../SKILL.md"), null);
  assert.equal(resolveChatSkillResourcePath(skill, "/etc/passwd"), null);
});
