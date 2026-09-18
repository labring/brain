import assert from "node:assert/strict";
import { test } from "node:test";

import { SESSION_SWR_KEYS } from "@/features/session/swr-keys";

import { githubReposSWRKey } from "./use-github-repos";

const CREDENTIALS = {
  appToken: "app-token",
  kubeconfig: "kubeconfig",
  namespace: " ns-demo ",
  regionalToken: "regional-token",
};

test("githubReposSWRKey is the session-keyed GitHub repos cache key", () => {
  assert.deepEqual(
    githubReposSWRKey(CREDENTIALS),
    SESSION_SWR_KEYS.githubUserRepos(CREDENTIALS)
  );
  assert.equal(githubReposSWRKey(CREDENTIALS)?.[0], "github-user-repos");
});

test("githubReposSWRKey returns null without namespace or kubeconfig", () => {
  assert.equal(githubReposSWRKey({ ...CREDENTIALS, namespace: "" }), null);
  assert.equal(githubReposSWRKey({ ...CREDENTIALS, kubeconfig: "" }), null);
});
