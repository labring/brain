import assert from "node:assert/strict";
import { test } from "node:test";

import {
  parseProjectTarget,
  projectApBoundPublicAccessTarget,
  projectApTarget,
  projectDbTarget,
  projectTargetKey,
  serializeProjectTarget,
  targetsEqual,
} from "./target-identity";

test("project surface targets serialize stable AP, DB, and AP-bound PublicAccess identities", () => {
  assert.equal(
    serializeProjectTarget({ kind: "AP", name: "api", namespace: "default" }),
    "ap:default:api"
  );
  assert.equal(
    serializeProjectTarget({ kind: "DB", name: "pg", namespace: "data" }),
    "db:data:pg"
  );
  assert.equal(
    serializeProjectTarget({
      apName: "api",
      kind: "PublicAccess",
      namespace: "default",
    }),
    "public-access:default:api"
  );
});

test("project surface targets decode without requiring Kubernetes UID", () => {
  assert.deepEqual(parseProjectTarget("ap:default:api"), {
    kind: "AP",
    name: "api",
    namespace: "default",
  });
  assert.deepEqual(parseProjectTarget("db:data:pg"), {
    kind: "DB",
    name: "pg",
    namespace: "data",
  });
  assert.deepEqual(parseProjectTarget("entry:default:api"), {
    apName: "api",
    kind: "PublicAccess",
    namespace: "default",
  });
  assert.deepEqual(parseProjectTarget("public-access:default:api"), {
    apName: "api",
    kind: "PublicAccess",
    namespace: "default",
  });
});

test("project surface targets carry optional observed UID without making it the identity key", () => {
  const first = projectApTarget({
    name: "api",
    namespace: "default",
    observedUid: "uid-1",
  });
  const recreated = projectApTarget({
    name: "api",
    namespace: "default",
    observedUid: "uid-2",
  });

  assert.notEqual(first, null);
  assert.equal(first?.observedUid, "uid-1");
  assert.equal(recreated?.observedUid, "uid-2");
  assert.equal(projectTargetKey(first), "AP:default:api");
  assert.equal(targetsEqual(first, recreated), true);
});

test("project surface target factories reject empty identity parts", () => {
  assert.equal(projectApTarget({ name: "", namespace: "default" }), null);
  assert.equal(projectDbTarget({ name: "pg", namespace: "" }), null);
  assert.equal(
    projectApBoundPublicAccessTarget({ apName: " ", namespace: "default" }),
    null
  );
});
