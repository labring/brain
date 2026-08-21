import { serializeProjectSideSurfaceEntry } from "@/features/panes/url-codec";
import {
  GITHUB_REPOSITORY_URL_MAX_LENGTH,
  normalizeGithubRepoUrl,
} from "./github-repo-url";

const GITHUB_REPOSITORY_URL_PREFIX_RE = /^https:\/\/github\.com\//i;

function publicGithubRepoUrl(value: string | string[] | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }
  const raw = value.trim();
  if (
    raw === "" ||
    raw.length > GITHUB_REPOSITORY_URL_MAX_LENGTH ||
    !GITHUB_REPOSITORY_URL_PREFIX_RE.test(raw)
  ) {
    return null;
  }
  return normalizeGithubRepoUrl(raw);
}

export function githubDeployProjectPath(
  githubRepo: string | string[] | null | undefined,
  autoDeploy?: string | string[] | null
): string {
  const normalizedRepo = publicGithubRepoUrl(githubRepo);
  const shouldAutoDeploy = autoDeploy === "1" && normalizedRepo != null;
  const side = serializeProjectSideSurfaceEntry({
    entryMode: "githubDirect",
    githubRepo: normalizedRepo ?? undefined,
    kind: "projectCreation",
    ...(shouldAutoDeploy ? { autoDeploy: true } : {}),
  });
  const searchParams = new URLSearchParams();
  if (side != null) {
    searchParams.set("side", side);
  }
  const query = searchParams.toString();
  return query === "" ? "/project" : `/project?${query}`;
}
