const GITHUB_API_BASE = "https://api.github.com";

/**
 * Anonymous GitHub API calls are limited to 60/hour per egress IP, which a
 * shared server exhausts quickly. Cache the anonymous answer for an hour; the
 * authenticated path has a 5000/hour budget and does not need it.
 */
const REPO_ACCESS_CACHE_SECONDS = 3600;

export const GITHUB_REPO_NOT_PUBLIC_ERROR =
  "This repository is not publicly accessible. Connect GitHub in Settings to deploy it.";

export interface GithubRepoPublicAccess {
  /** True when GitHub served the repository metadata for this caller. */
  accessible: boolean;
  /**
   * False when the check itself could not run (rate limit, network, provider
   * error). Callers must fail open: a deploy is not blocked by our inability
   * to ask, only by GitHub positively refusing.
   */
  checked: boolean;
}

function isRateLimited(response: Response): boolean {
  return response.headers.get("x-ratelimit-remaining") === "0";
}

/**
 * Ask GitHub whether a repository is readable before a task is created, so an
 * unbound deployment of a private repository fails at creation instead of
 * failing the clone minutes into a Codex run.
 */
export async function checkGithubRepoPublicAccess(input: {
  fullName: string;
  signal?: AbortSignal;
  token?: string | null;
}): Promise<GithubRepoPublicAccess> {
  const fullName = input.fullName.trim();
  if (fullName === "") {
    return { accessible: false, checked: true };
  }
  const token = input.token?.trim();
  try {
    const response = await fetch(
      `${GITHUB_API_BASE}/repos/${encodeURI(fullName)}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          ...(token == null || token === ""
            ? {}
            : { Authorization: `Bearer ${token}` }),
        },
        signal: input.signal,
        ...(token == null || token === ""
          ? { next: { revalidate: REPO_ACCESS_CACHE_SECONDS } }
          : {}),
      }
    );
    if (response.ok) {
      return { accessible: true, checked: true };
    }
    // Anonymous reads of a private repository are answered with 404, and a
    // 403 without an exhausted budget is a blocked repository. Either way
    // GitHub positively refused, so this is a real answer.
    if (response.status === 404) {
      return { accessible: false, checked: true };
    }
    if (response.status === 403 && !isRateLimited(response)) {
      return { accessible: false, checked: true };
    }
    return { accessible: false, checked: false };
  } catch {
    return { accessible: false, checked: false };
  }
}
