import type { DatabaseDeploymentChoice } from "@/features/deployment/database-deployer";

const DATABASE_PROJECT_FALLBACK_DISPLAY_NAME = "Database Project";

function normalizeProjectDisplayName(name: string): string {
  return name.trim().toLowerCase();
}

function databaseChoiceName(choice: DatabaseDeploymentChoice): string {
  return (
    choice.label.trim() ||
    choice.engine.trim() ||
    DATABASE_PROJECT_FALLBACK_DISPLAY_NAME
  );
}

export function deriveDatabaseProjectDisplayName({
  choice,
  existingProjectDisplayNames,
}: {
  choice: DatabaseDeploymentChoice;
  existingProjectDisplayNames: readonly string[];
}): string {
  const base = databaseChoiceName(choice);
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
