import { BRAIN_DISPLAY_NAME_ANNOTATION } from "@/lib/brain-labels";

/**
 * Resource Display Name (ADR 0062) — the one module that owns the resolution
 * chain (annotation → Kubernetes name), project-scoped numbering for
 * deploy-time defaults, and rename validation. Deploy paths and the settings
 * UI both read the rules from here so a name always resolves the same way
 * everywhere. A name is either written on the resource or it is the
 * Kubernetes name — nothing is derived at read time.
 */

/**
 * Matches the Project Display Name bound (ADR 0058) so neither layer is the
 * shorter channel. Counted in Unicode code points — keep in step with the Go
 * API's MaxDisplayNameLength (apps/api/service/orchestration/labels.go).
 */
export const MAX_RESOURCE_DISPLAY_NAME_LENGTH = 256;

function codePointLength(value: string): number {
  return [...value].length;
}

export interface ResourceDisplayNameFacts {
  annotations?: Record<string, unknown> | undefined;
  kubernetesName: string;
}

function boundedName(candidate: string): string {
  return [...candidate.trim()]
    .slice(0, MAX_RESOURCE_DISPLAY_NAME_LENGTH)
    .join("");
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

export interface TemplateResourceNamingResource {
  /** DB engine, when known — preferred over the Kubernetes name as suffix. */
  engine?: string | undefined;
  kind: "ap" | "db";
  kubernetesName: string;
}

function templateNameSuffix(identifier: string, templateName: string): string {
  const trimmed = identifier.trim();
  const lower = trimmed.toLowerCase();
  const template = templateName.trim().toLowerCase();
  if (lower === template) {
    return "";
  }
  if (lower.startsWith(`${template}-`)) {
    return trimmed.slice(template.length + 1);
  }
  return trimmed;
}

/**
 * Deploy-time display names for the resources one template instance spawned
 * (ADR 0062). The family shares the template name as base: the sole AP gets
 * the bare base, every other resource gets `base-<own identifier>` (an AP's
 * Kubernetes name, a DB's engine), and an identifier already carrying the
 * template name as prefix is not prefixed twice. On a repeat deployment the
 * base is numbered as a whole family (`wordpress-2`, `wordpress-2-mysql`) so
 * siblings stay recognizably grouped. Returns Kubernetes name → display name.
 */
export function templateResourceDisplayNames(input: {
  resources: TemplateResourceNamingResource[];
  takenNames: Iterable<string>;
  templateName: string;
}): Map<string, string> {
  const templateName = input.templateName.trim();
  if (templateName === "" || input.resources.length === 0) {
    return new Map();
  }
  const taken = new Set<string>();
  for (const name of input.takenNames) {
    taken.add(name.trim().toLowerCase());
  }
  const apCount = input.resources.filter(
    (resource) => resource.kind === "ap"
  ).length;

  const familyForBase = (base: string): Map<string, string> => {
    const local: string[] = [];
    const family = new Map<string, string>();
    for (const resource of input.resources) {
      let candidate: string;
      if (resource.kind === "ap" && apCount === 1) {
        candidate = base;
      } else {
        const identifier =
          resource.kind === "db"
            ? (resource.engine ?? resource.kubernetesName)
            : resource.kubernetesName;
        const suffix = templateNameSuffix(identifier, templateName);
        candidate = suffix === "" ? base : `${base}-${suffix}`;
      }
      const unique = uniqueResourceDisplayName(boundedName(candidate), local);
      local.push(unique);
      family.set(resource.kubernetesName, unique);
    }
    return family;
  };

  for (let attempt = 1; ; attempt += 1) {
    const base = attempt <= 1 ? templateName : `${templateName}-${attempt}`;
    const family = familyForBase(base);
    if ([...family.values()].every((name) => !taken.has(name.toLowerCase()))) {
      return family;
    }
  }
}

export type ResourceDisplayNameRename =
  | { kind: "invalid"; reason: "duplicate" | "too-long" }
  | { kind: "noop" }
  | { kind: "set"; value: string };

/**
 * Submit-time rename rules: trimmed, 1–256 characters, any script; empty is
 * a no-op — a stored name cannot be cleared back to the Kubernetes name
 * (ADR 0062); a duplicate of another resource's display name in the Project
 * is rejected.
 */
export function validateResourceDisplayNameRename(input: {
  takenNames: Iterable<string>;
  value: string;
}): ResourceDisplayNameRename {
  const value = input.value.trim();
  if (value === "") {
    return { kind: "noop" };
  }
  if (codePointLength(value) > MAX_RESOURCE_DISPLAY_NAME_LENGTH) {
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
 * settings patch pipelines. A name is only ever set, never deleted — a
 * stored name cannot be cleared back to the Kubernetes name (ADR 0062).
 */
export function resourceDisplayNameMergePatch(value: string): {
  metadata: { annotations: Record<string, string> };
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
