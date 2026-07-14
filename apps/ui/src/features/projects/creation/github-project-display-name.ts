export interface GithubProjectDisplayNameRepository {
  fullName?: string | null;
  name: string;
}

function normalizeProjectDisplayName(name: string): string {
  return name.trim().toLowerCase();
}

function repositoryName(repository: GithubProjectDisplayNameRepository) {
  const fullName = repository.fullName?.trim();
  if (fullName) {
    const [, repoName] = fullName.split("/");
    if (repoName?.trim()) {
      return repoName.trim();
    }
  }
  return repository.name.trim() || "GitHub Project";
}

export function deriveGithubProjectDisplayName({
  existingProjectDisplayNames,
  repository,
}: {
  existingProjectDisplayNames: readonly string[];
  repository: GithubProjectDisplayNameRepository;
}): string {
  const base = repositoryName(repository);
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
