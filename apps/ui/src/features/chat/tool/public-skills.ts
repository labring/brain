import "server-only";

import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const here = path.dirname(fileURLToPath(import.meta.url));

/** `apps/ui/public/skills` — stable regardless of `process.cwd()`. */
export const PUBLIC_SKILLS_ROOT = path.resolve(here, "../../../public/skills");

const FRONTMATTER_BLOCK_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export interface PublicSkillMeta {
  description: string;
  folderName: string;
  name: string;
  skillMdPath: string;
}

interface FrontmatterBlock {
  rest: string;
  yaml: string;
}

function extractFrontmatterBlock(raw: string): FrontmatterBlock | null {
  const match = raw.match(FRONTMATTER_BLOCK_RE);
  const yamlBlock = match?.[1];
  const fullMatch = match?.[0];
  if (yamlBlock == null || fullMatch == null) {
    return null;
  }
  return { yaml: yamlBlock, rest: raw.slice(fullMatch.length).trimStart() };
}

function parseSkillFrontmatterMeta(
  raw: string
): { description: string; name: string } | null {
  const block = extractFrontmatterBlock(raw);
  if (block == null) {
    return null;
  }
  let meta: unknown;
  try {
    meta = parseYaml(block.yaml);
  } catch {
    return null;
  }
  if (meta === null || typeof meta !== "object" || Array.isArray(meta)) {
    return null;
  }
  const record = meta as Record<string, unknown>;
  const name = record.name;
  const description = record.description;
  if (typeof name !== "string" || name.trim() === "") {
    return null;
  }
  if (typeof description !== "string" || description.trim() === "") {
    return null;
  }
  return { name: name.trim(), description: description.trim() };
}

async function readTextIfExists(pathToFile: string): Promise<string | null> {
  try {
    return await readFile(pathToFile, "utf-8");
  } catch {
    return null;
  }
}

/** Strip the YAML frontmatter so callers see only the SKILL.md body. */
export function stripSkillFrontmatter(raw: string): string {
  const parsed = extractFrontmatterBlock(raw);
  return parsed?.rest ?? raw.trim();
}

/**
 * Scan {@link PUBLIC_SKILLS_ROOT} for `<folder>/SKILL.md` files with valid
 * YAML frontmatter (`name`, `description`). Skills with duplicate names
 * (case-insensitive) keep the first occurrence and drop the rest.
 */
export async function discoverPublicSkills(): Promise<PublicSkillMeta[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(PUBLIC_SKILLS_ROOT, { withFileTypes: true });
  } catch {
    return [];
  }

  const skills: PublicSkillMeta[] = [];
  const seenNames = new Set<string>();

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue;
    }
    const folderName = entry.name;
    const skillMdPath = path.join(PUBLIC_SKILLS_ROOT, folderName, "SKILL.md");
    const raw = await readTextIfExists(skillMdPath);
    if (raw == null) {
      continue;
    }
    const meta = parseSkillFrontmatterMeta(raw);
    if (meta == null) {
      continue;
    }
    const key = meta.name.toLowerCase();
    if (seenNames.has(key)) {
      continue;
    }
    seenNames.add(key);
    skills.push({
      folderName,
      name: meta.name,
      description: meta.description,
      skillMdPath,
    });
  }

  return skills;
}
