import type { TemplateDeploymentChoice } from "@/features/deploy/template-deployer";

const TEMPLATE_PROJECT_FALLBACK_DISPLAY_NAME = "Template Project";

function normalizeProjectDisplayName(name: string): string {
  return name.trim().toLowerCase();
}

function templateChoiceName(choice: TemplateDeploymentChoice): string {
  return (
    choice.title.trim() ||
    choice.name.trim() ||
    TEMPLATE_PROJECT_FALLBACK_DISPLAY_NAME
  );
}

export function deriveTemplateProjectDisplayName({
  choice,
  existingProjectDisplayNames,
}: {
  choice: TemplateDeploymentChoice;
  existingProjectDisplayNames: readonly string[];
}): string {
  const base = templateChoiceName(choice);
  const existing = new Set(
    existingProjectDisplayNames.map(normalizeProjectDisplayName).filter(Boolean)
  );

  if (!existing.has(normalizeProjectDisplayName(base))) {
    return base;
  }

  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!existing.has(normalizeProjectDisplayName(candidate))) {
      return candidate;
    }
  }
}
