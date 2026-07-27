import { DIRECT_DB_DEPLOYMENT_OPTIONS } from "@/features/deploy/direct-db-deployment-options";
import type { DeploymentTaskSource } from "@/features/deploy/task/schema";

/**
 * Derived Project Display Name (ADR 0058). The platform names a Project from
 * its Deployment Source at creation; the rules live here as one pure module so
 * every entry point — UI panes, direct links, Chat, raw API callers — agrees,
 * and a future "name it before creating" field can prefill from the same code.
 */

/** Keeps a pathological image ref from turning into an unreadable list row. */
const MAX_DERIVED_DISPLAY_NAME_LENGTH = 128;
const USABLE_DISPLAY_NAME_RE = /[A-Za-z0-9]/;

const RANDOM_PROJECT_ADJECTIVES = [
  "bright",
  "calm",
  "clever",
  "cosmic",
  "dynamic",
  "fresh",
  "gentle",
  "happy",
  "lively",
  "lucky",
  "modern",
  "nimble",
  "quiet",
  "rapid",
  "smart",
  "steady",
  "swift",
  "vivid",
] as const;

const RANDOM_PROJECT_NOUNS = [
  "atlas",
  "bridge",
  "canvas",
  "cloud",
  "comet",
  "garden",
  "harbor",
  "kernel",
  "matrix",
  "meadow",
  "orbit",
  "portal",
  "signal",
  "stream",
  "studio",
  "summit",
  "valley",
  "voyage",
] as const;

function usableDisplayName(candidate: string): string | null {
  // Truncate before judging: a name whose only readable character sits past
  // the cap would otherwise survive as a row of punctuation.
  const bounded = candidate.trim().slice(0, MAX_DERIVED_DISPLAY_NAME_LENGTH);
  return USABLE_DISPLAY_NAME_RE.test(bounded) ? bounded : null;
}

/** `ghcr.io/org/my-api@sha256:…` and `localhost:5000/app:1` both name the app. */
function dockerImageDisplayName(settings: Record<string, unknown>): string {
  const image = typeof settings.image === "string" ? settings.image : "";
  const withoutDigest = image.trim().split("@", 1)[0] ?? "";
  const pathSegment = withoutDigest.split("/").at(-1) ?? "";
  return pathSegment.split(":", 1)[0] ?? "";
}

function databaseEngineDisplayName(settings: Record<string, unknown>): string {
  const databaseId =
    typeof settings.databaseId === "string" ? settings.databaseId.trim() : "";
  const option = DIRECT_DB_DEPLOYMENT_OPTIONS.find(
    (choice) => choice.id === databaseId
  );
  return option?.engine.toLowerCase() ?? "";
}

function sourceDisplayName(source: DeploymentTaskSource): string {
  switch (source.kind) {
    case "database":
      return databaseEngineDisplayName(source.settings);
    case "docker":
      return dockerImageDisplayName(source.settings);
    case "github":
      return source.repo.name;
    case "prompt":
      // Keyword extraction from free text is a poor heuristic; Chat names its
      // own Projects through the explicit channel instead.
      return "";
    case "template":
      return source.templateName;
    default:
      return source satisfies never;
  }
}

/**
 * The name a Deployment Source suggests, or `null` when it suggests none —
 * the shape a "name it before creating" field would want, so it can leave the
 * input blank rather than prefill a random name the user never asked for.
 */
export function derivedProjectDisplayNameBase(
  source: DeploymentTaskSource
): string | null {
  return usableDisplayName(sourceDisplayName(source));
}

function randomProjectWord<const T extends readonly [string, ...string[]]>(
  words: T
): T[number] {
  return words[Math.floor(Math.random() * words.length)] ?? words[0];
}

/** Readable last resort, so no Project ever lands with a blank or garbled name. */
export function randomProjectDisplayName(): string {
  return `${randomProjectWord(RANDOM_PROJECT_ADJECTIVES)}-${randomProjectWord(RANDOM_PROJECT_NOUNS)}`;
}

export function deriveProjectDisplayName(source: DeploymentTaskSource): string {
  return derivedProjectDisplayNameBase(source) ?? randomProjectDisplayName();
}

/** `nginx`, `nginx-2`, `nginx-3`, … — attempt 1 keeps the bare derived name. */
export function projectDisplayNameWithSuffix(
  base: string,
  attempt: number
): string {
  return attempt <= 1 ? base : `${base}-${attempt}`;
}
