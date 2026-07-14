import type { GithubDeployerRepo } from "@/features/deploy/github-deployer/github-deployer.types";
import type { TemplateDeploymentChoice } from "@/features/deploy/template-deployer";

const GIT_SUFFIX_RE = /\.git$/i;
const GITHUB_SSH_RE = /^git@github\.com:([^/]+)\/(.+)$/i;
const URL_PROTOCOL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

export function normalizeGithubRepoReference(input: string): string | null {
  const raw = input.trim();
  if (!raw) {
    return null;
  }

  const ssh = GITHUB_SSH_RE.exec(raw);
  if (ssh) {
    const owner = ssh[1]?.trim();
    const repo = ssh[2]?.trim().replace(GIT_SUFFIX_RE, "");
    return owner && repo ? `${owner}/${repo}`.toLowerCase() : null;
  }

  const fullName = normalizeGithubFullName(raw);
  if (fullName != null) {
    return fullName;
  }

  const withProtocol = URL_PROTOCOL_RE.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    return normalizeGithubFullName(raw);
  }

  if (url.hostname.toLowerCase() !== "github.com") {
    return null;
  }

  const [owner, repoSegment] = url.pathname
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  const repo = repoSegment?.replace(GIT_SUFFIX_RE, "");
  return owner && repo ? `${owner}/${repo}`.toLowerCase() : null;
}

function normalizeGithubFullName(input: string): string | null {
  const [owner, repo, extra] = input
    .replace(GIT_SUFFIX_RE, "")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  return owner && repo && extra == null
    ? `${owner}/${repo}`.toLowerCase()
    : null;
}

export function githubRepoReferenceForRepo(
  repo: GithubDeployerRepo
): string | null {
  return (
    normalizeGithubRepoReference(repo.fullName ?? "") ??
    normalizeGithubRepoReference(repo.url ?? "")
  );
}

export function templateCanDeployWithDefaults(
  template: TemplateDeploymentChoice
): boolean {
  return template.args.every(
    (arg) => !arg.required || (arg.default?.trim() ?? "") !== ""
  );
}

export function defaultTemplateArgs(
  template: TemplateDeploymentChoice
): Record<string, string> {
  return Object.fromEntries(
    template.args.map((arg) => [arg.key, arg.default ?? ""])
  );
}

export function findTemplateForGithubRepo(input: {
  repo: GithubDeployerRepo;
  templates: readonly TemplateDeploymentChoice[];
}): TemplateDeploymentChoice | null {
  const repoRef = githubRepoReferenceForRepo(input.repo);
  if (repoRef == null) {
    return null;
  }
  return (
    input.templates.find((template) =>
      (template.sourceRepos ?? []).some(
        (sourceRepo) => normalizeGithubRepoReference(sourceRepo) === repoRef
      )
    ) ?? null
  );
}
