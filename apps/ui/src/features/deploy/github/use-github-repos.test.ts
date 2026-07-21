import assert from "node:assert/strict";
import { test } from "node:test";

import { githubReposSWRKey } from "./use-github-repos";

test("githubReposSWRKey matches the GitHub repos cache key", () => {
  assert.deepEqual(
    githubReposSWRKey({
      kubeconfig: "kubeconfig",
      namespace: " ns-demo ",
    }),
    ["github-user-repos", "ns-demo", "kubeconfig"]
  );
});

test("githubReposSWRKey returns null without namespace or kubeconfig", () => {
  assert.equal(
    githubReposSWRKey({
      kubeconfig: "kubeconfig",
      namespace: "",
    }),
    null
  );
  assert.equal(
    githubReposSWRKey({
      kubeconfig: "",
      namespace: "ns-demo",
    }),
    null
  );
});
