import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { ChatDevboxSandbox } from "@/features/chat/devbox/chat-runtime";
import {
  SEALOS_INTERNAL_CHAT_SKILL_NAMES,
  SEALOS_SKILLS_WORKSPACE_DIR,
} from "@/features/sealos-skills/install";

const FRONTMATTER_BLOCK_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const RESOURCE_PATH_SEGMENTS_RE = /[\\/]+/;
const LINES_RE = /\r?\n/;
const SKILL_ROOTS = [
  `${SEALOS_SKILLS_WORKSPACE_DIR}/.agents/skills`,
  `${SEALOS_SKILLS_WORKSPACE_DIR}/.codex/skills`,
];

export interface ChatSkillMeta {
  description: string;
  folderName: string;
  name: string;
  skillDirectory: string;
  skillMdPath: string;
}

interface FrontmatterBlock {
  rest: string;
  yaml: string;
}

function extractFrontmatterBlock(raw: string): FrontmatterBlock | null {
  const match = raw.match(FRONTMATTER_BLOCK_RE);
  if (match?.[1] == null || match[0] == null) {
    return null;
  }
  return { yaml: match[1], rest: raw.slice(match[0].length).trimStart() };
}

function parseSkillFrontmatterMeta(
  raw: string
): { description: string; name: string } | null {
  const block = extractFrontmatterBlock(raw);
  if (block == null) {
    return null;
  }

  let metadata: unknown;
  try {
    metadata = parseYaml(block.yaml);
  } catch {
    return null;
  }
  if (
    metadata === null ||
    typeof metadata !== "object" ||
    Array.isArray(metadata)
  ) {
    return null;
  }

  const record = metadata as Record<string, unknown>;
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

function isInternalChatSkill(name: string): boolean {
  return SEALOS_INTERNAL_CHAT_SKILL_NAMES.some(
    (internalName) => internalName.toLowerCase() === name.toLowerCase()
  );
}

function skillDiscoveryCommand(): string {
  return [
    "set -euo pipefail",
    "for skill_root in",
    ...SKILL_ROOTS.map((root) => `  ${root}`),
    "do",
    '  if [ -d "$skill_root" ]; then',
    '    find "$skill_root" -mindepth 2 -maxdepth 2 -type f -name SKILL.md -print',
    "  fi",
    "done",
  ].join("\n");
}

/** Discover user-facing Skills installed in the Chat Devbox. */
export async function discoverChatDevboxSkills(
  sandbox: ChatDevboxSandbox
): Promise<ChatSkillMeta[]> {
  const result = await sandbox.executeCommand(skillDiscoveryCommand());
  if (result.exitCode !== 0) {
    throw new Error(
      `Chat Devbox Skill discovery failed: ${result.stderr || result.stdout}`.trim()
    );
  }

  const skills: ChatSkillMeta[] = [];
  const seenNames = new Set<string>();
  const skillPaths = result.stdout
    .split(LINES_RE)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .sort();

  for (const skillMdPath of skillPaths) {
    const raw = await sandbox.readFile(skillMdPath);
    const metadata = parseSkillFrontmatterMeta(raw);
    if (metadata == null || isInternalChatSkill(metadata.name)) {
      continue;
    }

    const key = metadata.name.toLowerCase();
    if (seenNames.has(key)) {
      continue;
    }
    seenNames.add(key);

    const skillDirectory = path.posix.dirname(skillMdPath);
    skills.push({
      ...metadata,
      folderName: path.posix.basename(skillDirectory),
      skillDirectory,
      skillMdPath,
    });
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

export function resolveChatSkillResourcePath(
  skill: ChatSkillMeta,
  resourcePath: string
): string | null {
  const requested = resourcePath.trim();
  if (
    requested === "" ||
    requested.includes("\0") ||
    path.posix.isAbsolute(requested)
  ) {
    return null;
  }

  const segments = requested.split(RESOURCE_PATH_SEGMENTS_RE);
  if (segments.some((segment) => segment === ".." || segment === ".")) {
    return null;
  }

  const resolved = path.posix.resolve(skill.skillDirectory, requested);
  if (
    resolved !== skill.skillDirectory &&
    !resolved.startsWith(`${skill.skillDirectory}/`)
  ) {
    return null;
  }
  return resolved;
}

export function stripSkillFrontmatter(raw: string): string {
  return extractFrontmatterBlock(raw)?.rest ?? raw.trim();
}
