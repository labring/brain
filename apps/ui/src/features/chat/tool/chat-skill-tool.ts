import { tool } from "ai";
import { z } from "zod";
import type { ChatDevboxSandbox } from "@/features/chat/devbox/chat-runtime";
import {
  chatToolIntentionField,
  logChatToolIntention,
} from "@/features/chat/tool/chat-tool-intention";
import {
  type ChatSkillMeta,
  resolveChatSkillResourcePath,
  stripSkillFrontmatter,
} from "./devbox-skills";

// biome-ignore lint/performance/noBarrelFile: single import surface for chat route (discovery + tool)
export { type ChatSkillMeta, discoverChatDevboxSkills } from "./devbox-skills";

/** Input for `loadSkill` — skill `name` from SKILL.md frontmatter. */
export const loadSkillInputSchema = z.object({
  intention: chatToolIntentionField,
  name: z
    .string()
    .describe("Skill `name` from YAML frontmatter / Available skills list"),
});

export const loadSkillResourceInputSchema = z.object({
  intention: chatToolIntentionField,
  name: z
    .string()
    .describe("Skill name from YAML frontmatter / Available skills list"),
  path: z
    .string()
    .describe("Relative resource path inside the skill directory"),
});

export function buildLoadSkillDescription(): string {
  return [
    "Load full markdown instructions for a named skill.",
    "Skills live in the Chat Devbox under `/home/devbox/project/.agents/skills/<folder>/SKILL.md` or `/home/devbox/project/.codex/skills/<folder>/SKILL.md` with YAML frontmatter (`name`, `description`).",
    "Call when the user's task matches a skill listed in the system prompt. Returns body text without frontmatter.",
    "Always set `intention`: which user goal this skill satisfies.",
  ].join(" ");
}

export function buildLoadSkillResourceDescription(): string {
  return [
    "Load a text resource referenced by a named skill, such as a module, reference, schema, template, knowledge file, or script.",
    "The path is relative to that skill directory and must not contain parent-directory segments.",
    "Call after loadSkill when the skill instructions reference an additional file needed for the current phase.",
    "Always set intention: which user goal this resource supports.",
  ].join(" ");
}

/**
 * System-prompt fragment listing discovered skills (names + descriptions only).
 * Full SKILL.md body is loaded via `loadSkill`.
 */
export function buildChatSkillsDiscoveryPrompt(
  entries: ChatSkillMeta[]
): string {
  if (entries.length === 0) {
    return [
      "## Skills (on-demand)",
      "There are no user-facing Sealos skills installed in the Chat Devbox. Each skill is a folder containing `SKILL.md` with YAML frontmatter (`name`, `description`). When skills exist and the user’s task matches one, call `loadSkill` with that skill’s `name`; use `loadSkillResource` for referenced files inside that skill directory.",
    ].join("\n");
  }
  const bullets = entries
    .map((s) => `- **${s.name}**: ${s.description}`)
    .join("\n");
  return [
    "## Skills (on-demand)",
    "When the user's task matches a skill description, call `loadSkill` with that skill's `name` to load its full instructions. If those instructions reference modules, references, knowledge, templates, schemas, assets, or scripts needed for the current task, call `loadSkillResource` with their relative path. Do not invent skill content without loading.",
    "",
    "Available skills:",
    bullets,
  ].join("\n");
}

export function createLoadSkillTool(
  skillIndex: ChatSkillMeta[],
  sandbox: ChatDevboxSandbox
) {
  return tool({
    description: buildLoadSkillDescription(),
    inputSchema: loadSkillInputSchema,
    execute: async ({ intention, name }) => {
      logChatToolIntention("loadSkill", intention);
      const key = name.trim().toLowerCase();
      const skill = skillIndex.find((s) => s.name.toLowerCase() === key);
      if (skill == null) {
        return { error: `Unknown skill: ${name}` };
      }
      const raw = await sandbox.readFile(skill.skillMdPath);
      return {
        name: skill.name,
        skillDirectory: skill.folderName,
        content: stripSkillFrontmatter(raw),
      };
    },
  });
}

export function createLoadSkillResourceTool(
  skillIndex: ChatSkillMeta[],
  sandbox: ChatDevboxSandbox
) {
  return tool({
    description: buildLoadSkillResourceDescription(),
    inputSchema: loadSkillResourceInputSchema,
    execute: async ({ intention, name, path: resourcePath }) => {
      logChatToolIntention("loadSkillResource", intention);
      const key = name.trim().toLowerCase();
      const skill = skillIndex.find((s) => s.name.toLowerCase() === key);
      if (skill == null) {
        return { error: `Unknown skill: ${name}` };
      }

      const resourceFilePath = resolveChatSkillResourcePath(
        skill,
        resourcePath
      );
      if (resourceFilePath == null) {
        return { error: `Invalid skill resource path: ${resourcePath}` };
      }

      try {
        const content = await sandbox.readFile(resourceFilePath);
        return {
          name: skill.name,
          skillDirectory: skill.folderName,
          path: resourcePath.trim(),
          content,
        };
      } catch {
        return {
          error:
            "Skill resource not found: " +
            skill.name +
            "/" +
            resourcePath.trim(),
        };
      }
    },
  });
}
