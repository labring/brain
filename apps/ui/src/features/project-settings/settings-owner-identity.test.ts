import assert from "node:assert/strict";
import { test } from "node:test";
import { settingsOwnerIdentity } from "./settings-owner-identity";

const SECRET_TOKEN_RE = /secret-token/;

test("settings owner identity scopes same AP name by cluster fingerprint and uid", () => {
  const target = {
    kind: "AP" as const,
    name: "api",
    namespace: "default",
    observedUid: "ap-uid-1",
  };
  const prodKubeconfig = "cluster: prod\nuser: admin\nsecret-token";
  const stagingKubeconfig = "cluster: staging\nuser: admin\nsecret-token";

  const prodOwner = settingsOwnerIdentity({
    kubeconfig: prodKubeconfig,
    target,
  });
  const stagingOwner = settingsOwnerIdentity({
    kubeconfig: stagingKubeconfig,
    target,
  });
  const recreatedOwner = settingsOwnerIdentity({
    kubeconfig: prodKubeconfig,
    target: { ...target, observedUid: "ap-uid-2" },
  });

  assert.notEqual(
    prodOwner?.clusterFingerprint,
    stagingOwner?.clusterFingerprint
  );
  assert.notEqual(prodOwner?.uid, recreatedOwner?.uid);
  assert.doesNotMatch(prodOwner?.clusterFingerprint ?? "", SECRET_TOKEN_RE);
  assert.equal(prodOwner?.kind, "ap");
  assert.equal(prodOwner?.uid, "ap-uid-1");
});

test("settings owner identity uses the database owner kind and omits empty uid", () => {
  const owner = settingsOwnerIdentity({
    kubeconfig: "cluster: prod",
    target: {
      kind: "DB",
      name: "postgres",
      namespace: "database-system",
    },
  });

  assert.equal(owner?.kind, "database");
  assert.equal(owner?.uid, undefined);
});
