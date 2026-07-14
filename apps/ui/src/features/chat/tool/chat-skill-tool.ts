import { readFile } from "node:fs/promises";
import { tool } from "ai";
import { z } from "zod";
import {
  chatToolIntentionField,
  logChatToolIntention,
} from "@/features/chat/tool/chat-tool-intention";
import { type PublicSkillMeta, stripSkillFrontmatter } from "./public-skills";

// biome-ignore lint/performance/noBarrelFile: single import surface for chat route (discovery + tool)
export { discoverPublicSkills, type PublicSkillMeta } from "./public-skills";

/** Input for `loadSkill` — skill `name` from SKILL.md frontmatter. */
export const loadSkillInputSchema = z.object({
  intention: chatToolIntentionField,
  name: z
    .string()
    .describe("Skill `name` from YAML frontmatter / Available skills list"),
});

export function buildLoadSkillDescription(): string {
  return [
    "Load full markdown instructions for a named skill.",
    "Skills live under `public/skills/<folder>/SKILL.md` with YAML frontmatter (`name`, `description`).",
    "Call when the user's task matches a skill listed in the system prompt. Returns body text without frontmatter.",
    "Always set `intention`: which user goal this skill satisfies.",
  ].join(" ");
}

/**
 * System-prompt fragment listing discovered skills (names + descriptions only).
 * Full SKILL.md body is loaded via `loadSkill`.
 */
export function buildChatSkillsDiscoveryPrompt(
  entries: PublicSkillMeta[]
): string {
  if (entries.length === 0) {
    return [
      "## Skills (on-demand)",
      "There are no skills under `public/skills/*/SKILL.md`. Each skill is a folder containing `SKILL.md` with YAML frontmatter (`name`, `description`). When skills exist and the user’s task matches one, call `loadSkill` with that skill’s `name`.",
    ].join("\n");
  }
  const bullets = entries
    .map((s) => `- **${s.name}**: ${s.description}`)
    .join("\n");
  return [
    "## Skills (on-demand)",
    "When the user's task matches a skill description, call `loadSkill` with that skill's `name` to load its full instructions. Do not invent skill content without loading.",
    "",
    "Available skills:",
    bullets,
  ].join("\n");
}

export function createLoadSkillTool(skillIndex: PublicSkillMeta[]) {
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
      const raw = await readFile(skill.skillMdPath, "utf-8");
      return {
        name: skill.name,
        skillDirectory: skill.folderName,
        content: stripSkillFrontmatter(raw),
      };
    },
  });
}
