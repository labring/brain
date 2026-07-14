const DOCKER_PROJECT_FALLBACK_DISPLAY_NAME = "Docker Project";
const USABLE_DISPLAY_NAME_RE = /[A-Za-z0-9]/;

function normalizeProjectDisplayName(name: string): string {
  return name.trim().toLowerCase();
}

function repositorySegment(imageRef: string): string {
  const withoutDigest = imageRef.trim().split("@", 1)[0] ?? "";
  const finalPathSegment = withoutDigest.split("/").at(-1)?.trim() ?? "";
  const withoutTag = finalPathSegment.split(":", 1)[0]?.trim() ?? "";
  return USABLE_DISPLAY_NAME_RE.test(withoutTag)
    ? withoutTag
    : DOCKER_PROJECT_FALLBACK_DISPLAY_NAME;
}

export function deriveDockerProjectDisplayName({
  existingProjectDisplayNames,
  imageRef,
}: {
  existingProjectDisplayNames: readonly string[];
  imageRef: string;
}): string {
  const base = repositorySegment(imageRef);
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
