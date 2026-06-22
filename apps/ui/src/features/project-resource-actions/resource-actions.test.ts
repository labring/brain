import assert from "node:assert/strict";
import { test } from "node:test";
import {
  apLifecycleWorkloadRefFromTarget,
  dbLifecycleWorkloadRefFromTarget,
} from "./resource-actions";

test("Resource Actions use AP and DB target identities as lifecycle workload refs", () => {
  assert.deepEqual(
    apLifecycleWorkloadRefFromTarget({
      kind: "AP",
      name: " api ",
      namespace: " default ",
    }),
    { name: "api", namespace: "default" }
  );
  assert.deepEqual(
    dbLifecycleWorkloadRefFromTarget({
      kind: "DB",
      name: " postgres ",
      namespace: " default ",
    }),
    { name: "postgres", namespace: "default" }
  );
  assert.equal(apLifecycleWorkloadRefFromTarget(null), null);
  assert.equal(dbLifecycleWorkloadRefFromTarget(undefined), null);
});
