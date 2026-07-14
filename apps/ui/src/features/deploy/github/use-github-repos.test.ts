import assert from "node:assert/strict";
import { test } from "node:test";

import { githubReposSWRKey } from "./use-github-repos";

test("githubReposSWRKey matches the GitHub repos cache key", () => {
  assert.deepEqual(
    githubReposSWRKey({
      kubeconfig: "kubeconfig",
      namespace: " ns-demo ",
      userId: " admin ",
    }),
    ["github-user-repos", "ns-demo", "admin", "kubeconfig"]
  );
});

test("githubReposSWRKey returns null without namespace or user ID", () => {
  assert.equal(
    githubReposSWRKey({
      kubeconfig: "kubeconfig",
      namespace: "",
      userId: "admin",
    }),
    null
  );
  assert.equal(
    githubReposSWRKey({
      kubeconfig: "kubeconfig",
      namespace: "ns-demo",
      userId: "",
    }),
    null
  );
});
