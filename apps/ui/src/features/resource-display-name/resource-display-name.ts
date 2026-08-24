import { BRAIN_DISPLAY_NAME_ANNOTATION } from "@/lib/brain-labels";

/**
 * Resource Display Name (ADR 0062) — the one module that owns the resolution
 * chain (annotation → Kubernetes name), project-scoped numbering for
 * deploy-time defaults, and rename validation. Deploy paths and the settings
 * UI both read the rules from here so a name always resolves the same way
 * everywhere. A name is either written on the resource or it is the
 * Kubernetes name — nothing is derived at read time.
 */

/** Matches the Project Display Name bound (ADR 0058) so neither layer is the shorter channel. */
export const MAX_RESOURCE_DISPLAY_NAME_LENGTH = 256;

export interface ResourceDisplayNameFacts {
  annotations?: Record<string, unknown> | undefined;
  kubernetesName: string;
}

function boundedName(candidate: string): string {
  return candidate.trim().slice(0, MAX_RESOURCE_DISPLAY_NAME_LENGTH);
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
 * restores the Kubernetes name (annotation removal); a duplicate of another
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
 * settings patch pipelines. `null` deletes the key, restoring the Kubernetes
 * name on the next read (merge-patch semantics on both product routes).
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

export function resolveResourceDisplayName(
  facts: ResourceDisplayNameFacts
): string {
  return annotatedDisplayName(facts.annotations) ?? facts.kubernetesName;
}
