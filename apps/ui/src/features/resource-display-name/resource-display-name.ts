import { dockerImageNameSegment } from "@/features/projects/derived-project-display-name";
import {
  BRAIN_DISPLAY_NAME_ANNOTATION,
  BRAIN_TEMPLATE_NAME_LABEL,
} from "@/lib/brain-labels";

/**
 * Resource Display Name (ADR 0062) — the one module that owns the resolution
 * chain (annotation → derived default → Kubernetes name), project-scoped
 * numbering for derived defaults, and rename validation. Deploy paths and the
 * settings UI both read the rules from here so a name always resolves the
 * same way everywhere.
 */

/** Matches the Project Display Name bound (ADR 0058) so neither layer is the shorter channel. */
export const MAX_RESOURCE_DISPLAY_NAME_LENGTH = 256;
const USABLE_DISPLAY_NAME_RE = /[A-Za-z0-9]/;

export interface ApDisplayNameFacts {
  annotations?: Record<string, unknown> | undefined;
  image?: string | undefined;
  kubernetesName: string;
  labels?: Record<string, unknown> | undefined;
}

export interface DbDisplayNameFacts {
  annotations?: Record<string, unknown> | undefined;
  engine?: string | undefined;
  kubernetesName: string;
  labels?: Record<string, unknown> | undefined;
}

function boundedName(candidate: string): string {
  return candidate.trim().slice(0, MAX_RESOURCE_DISPLAY_NAME_LENGTH);
}

/** Derived names must stay readable; user-chosen names may be any script. */
function usableDerivedName(candidate: string | undefined): string | null {
  if (candidate === undefined) {
    return null;
  }
  const bounded = boundedName(candidate);
  return USABLE_DISPLAY_NAME_RE.test(bounded) ? bounded : null;
}

function annotatedDisplayName(
  annotations: Record<string, unknown> | undefined
): string | null {
  const value = annotations?.[BRAIN_DISPLAY_NAME_ANNOTATION];
  if (typeof value !== "string") {
    return null;
  }
  const bounded = boundedName(value);
  return bounded === "" ? null : bounded;
}

function templateNameFromLabels(
  labels: Record<string, unknown> | undefined
): string | undefined {
  const value = labels?.[BRAIN_TEMPLATE_NAME_LABEL];
  return typeof value === "string" ? value : undefined;
}

/**
 * Lazily derived default for an AP, mirroring deploy-time derivation from the
 * Deployment Source: template instances read as their template, direct docker
 * deploys as the image's final path segment.
 */
export function derivedApDisplayNameBase(
  facts: Pick<ApDisplayNameFacts, "image" | "labels">
): string | null {
  return (
    usableDerivedName(templateNameFromLabels(facts.labels)) ??
    usableDerivedName(
      facts.image === undefined
        ? undefined
        : dockerImageNameSegment(facts.image)
    )
  );
}

/**
 * Lazily derived default for a DB. The engine outranks the template-name
 * label so a template's database node reads as `postgresql`, distinct from
 * the template-named app node beside it.
 */
export function derivedDbDisplayNameBase(
  facts: Pick<DbDisplayNameFacts, "engine" | "labels">
): string | null {
  return (
    usableDerivedName(facts.engine?.toLowerCase()) ??
    usableDerivedName(templateNameFromLabels(facts.labels))
  );
}

/**
 * Deploy-time numbering within a Project: `nginx`, `nginx-2`, `nginx-3` …
 * Comparison is case-insensitive because the uniqueness rule exists only for
 * human distinguishability (same rationale as ADR 0058).
 */
export function uniqueResourceDisplayName(
  base: string,
  takenNames: Iterable<string>
): string {
  const taken = new Set<string>();
  for (const name of takenNames) {
    taken.add(name.trim().toLowerCase());
  }
  let attempt = 1;
  for (;;) {
    const candidate = attempt <= 1 ? base : `${base}-${attempt}`;
    if (!taken.has(candidate.toLowerCase())) {
      return candidate;
    }
    attempt += 1;
  }
}

export type ResourceDisplayNameRename =
  | { kind: "clear" }
  | { kind: "invalid"; reason: "duplicate" | "too-long" }
  | { kind: "set"; value: string };

/**
 * Submit-time rename rules: trimmed, 1–256 characters, any script; empty
 * restores the derived default (annotation removal); a duplicate of another
 * resource's display name in the Project is rejected.
 */
export function validateResourceDisplayNameRename(input: {
  takenNames: Iterable<string>;
  value: string;
}): ResourceDisplayNameRename {
  const value = input.value.trim();
  if (value === "") {
    return { kind: "clear" };
  }
  if (value.length > MAX_RESOURCE_DISPLAY_NAME_LENGTH) {
    return { kind: "invalid", reason: "too-long" };
  }
  const normalized = value.toLowerCase();
  for (const name of input.takenNames) {
    if (name.trim().toLowerCase() === normalized) {
      return { kind: "invalid", reason: "duplicate" };
    }
  }
  return { kind: "set", value };
}

/**
 * JSON merge patch for the display-name annotation, shared by the AP and DB
 * settings patch pipelines. `null` deletes the key, restoring the derived
 * default on the next read (merge-patch semantics on both product routes).
 */
export function resourceDisplayNameMergePatch(value: string | null): {
  metadata: { annotations: Record<string, string | null> };
} {
  return {
    metadata: {
      annotations: { [BRAIN_DISPLAY_NAME_ANNOTATION]: value },
    },
  };
}

export function resolveApDisplayName(facts: ApDisplayNameFacts): string {
  return (
    annotatedDisplayName(facts.annotations) ??
    derivedApDisplayNameBase(facts) ??
    facts.kubernetesName
  );
}

export function resolveDbDisplayName(facts: DbDisplayNameFacts): string {
  return (
    annotatedDisplayName(facts.annotations) ??
    derivedDbDisplayNameBase(facts) ??
    facts.kubernetesName
  );
}
