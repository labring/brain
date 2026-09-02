import assert from "node:assert/strict";
import { test } from "node:test";

import { parseProjectSideRouteState } from "@/features/panes/side-url-codec";
import { githubDeployProjectPath } from "./github-deploy-link";
import { GITHUB_REPOSITORY_URL_MAX_LENGTH } from "./github-repo-url";

function sideFromPath(path: string) {
  const url = new URL(path, "https://brain.test");
  return parseProjectSideRouteState({ side: url.searchParams.get("side") })
    .side;
}

test("GitHub deploy link opens a direct creation flow with a canonical repo", () => {
  assert.deepEqual(
    sideFromPath(
      githubDeployProjectPath("https://github.com/acme/api.git", "1")
    ),
    {
      autoDeploy: true,
      entryMode: "githubDirect",
      githubRepo: "https://github.com/acme/api",
      kind: "projectCreation",
    }
  );
});

test("GitHub deploy link defaults to manual deployment", () => {
  assert.deepEqual(
    sideFromPath(githubDeployProjectPath("https://github.com/acme/api")),
    {
      entryMode: "githubDirect",
      githubRepo: "https://github.com/acme/api",
      kind: "projectCreation",
    }
  );
});

test("GitHub deploy link fails closed for malformed public values", () => {
  for (const value of [
    undefined,
    null,
    "   ",
    ["https://github.com/acme/api", "https://github.com/acme/other"],
    "https://github.com/acme/api/tree/main",
    "https://token:secret@github.com/acme/api",
    `https://github.com/acme/${"x".repeat(GITHUB_REPOSITORY_URL_MAX_LENGTH)}`,
  ]) {
    assert.deepEqual(sideFromPath(githubDeployProjectPath(value)), {
      entryMode: "githubDirect",
      kind: "projectCreation",
    });
  }
});

test("GitHub deploy link ignores an invalid autoDeploy flag", () => {
  assert.deepEqual(
    sideFromPath(
      githubDeployProjectPath("https://github.com/acme/api", ["1", "1"])
    ),
    {
      entryMode: "githubDirect",
      githubRepo: "https://github.com/acme/api",
      kind: "projectCreation",
    }
  );
});
