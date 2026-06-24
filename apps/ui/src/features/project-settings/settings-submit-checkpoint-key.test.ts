import assert from "node:assert/strict";
import { test } from "node:test";
import { settingsSubmitCheckpointKey } from "./settings-submit-checkpoint-key";

const DATABASE_KEY_PREFIX_RE = /^database:/;
const SECRET_TOKEN_RE = /secret-token/;
const UID_EMPTY_RE = /uid:$/;
const UID_RE = /uid:ap-uid-1/;

test("settings submit checkpoint key scopes same AP name by cluster fingerprint and uid", () => {
  const target = {
    kind: "AP" as const,
    name: "api",
    namespace: "default",
    observedUid: "ap-uid-1",
  };
  const prodKubeconfig = "cluster: prod\nuser: admin\nsecret-token";
  const stagingKubeconfig = "cluster: staging\nuser: admin\nsecret-token";

  const prodKey = settingsSubmitCheckpointKey({
    kubeconfig: prodKubeconfig,
    target,
  });
  const stagingKey = settingsSubmitCheckpointKey({
    kubeconfig: stagingKubeconfig,
    target,
  });
  const recreatedKey = settingsSubmitCheckpointKey({
    kubeconfig: prodKubeconfig,
    target: { ...target, observedUid: "ap-uid-2" },
  });

  assert.notEqual(prodKey, stagingKey);
  assert.notEqual(prodKey, recreatedKey);
  assert.doesNotMatch(prodKey ?? "", SECRET_TOKEN_RE);
  assert.match(prodKey ?? "", UID_RE);
});

test("settings submit checkpoint key uses the database owner kind", () => {
  const key = settingsSubmitCheckpointKey({
    kubeconfig: "cluster: prod",
    target: {
      kind: "DB",
      name: "postgres",
      namespace: "database-system",
    },
  });

  assert.match(key ?? "", DATABASE_KEY_PREFIX_RE);
  assert.match(key ?? "", UID_EMPTY_RE);
});
