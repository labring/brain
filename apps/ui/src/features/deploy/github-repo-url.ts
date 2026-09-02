import type { GithubDeployerRepo } from "./github-deployer/github-deployer.types";

export const GITHUB_REPOSITORY_URL_MAX_LENGTH = 512;

const URL_PROTOCOL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
const GIT_SUFFIX_RE = /\.git$/i;

/** Parse a GitHub repository root accepted by both manual and link flows. */
export function githubUrlToRepo(input: string): GithubDeployerRepo | null {
  const raw = input.trim();
  if (raw === "" || raw.length > GITHUB_REPOSITORY_URL_MAX_LENGTH) {
    return null;
  }

  const withProtocol = URL_PROTOCOL_RE.test(raw) ? raw : `https://${raw}`;

  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    return null;
  }

  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== "github.com" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    return null;
  }

  const [owner, repoSegment, extraPath] = url.pathname
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  const repo = repoSegment?.replace(GIT_SUFFIX_RE, "");
  if (!(owner && repo) || extraPath != null) {
    return null;
  }

  const fullName = `${owner}/${repo}`;
  return {
    fullName,
    id: `github-url:${fullName}`,
    name: repo,
    url: `https://github.com/${fullName}`,
  };
}

export function normalizeGithubRepoUrl(
  value: string | null | undefined
): string | null {
  const repo = typeof value === "string" ? githubUrlToRepo(value) : null;
  return repo?.url ?? null;
}

/**
 * Keep persisted/audited repository identity aligned with the exact GitHub
 * repository root the runner will clone.
 */
export function githubRepoFieldsMatchUrl(input: {
  fullName: string;
  name: string;
  url: string;
}): boolean {
  const parsed = githubUrlToRepo(input.url);
  if (parsed?.fullName == null) {
    return false;
  }

  return (
    parsed.fullName.toLowerCase() === input.fullName.trim().toLowerCase() &&
    parsed.name.toLowerCase() === input.name.trim().toLowerCase()
  );
}
