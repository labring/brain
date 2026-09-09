import assert from "node:assert/strict";
import { test } from "node:test";

import {
  UNKNOWN_WORKSPACE_OWNER_STANDING,
  workspaceOwnerStandingFromNamespace,
} from "./workspace-owner";

function namespace(input: {
  annotations?: Record<string, string>;
  labels?: Record<string, string>;
}): unknown {
  return {
    apiVersion: "v1",
    kind: "Namespace",
    metadata: {
      annotations: input.annotations,
      labels: input.labels,
      name: "ns-alice",
    },
  };
}

test("the owner label names the caller as the Workspace Owner", () => {
  assert.deepEqual(
    workspaceOwnerStandingFromNamespace(
      namespace({ labels: { "user.sealos.io/owner": "alice" } }),
      "alice"
    ),
    { isOwner: true, platformDebt: false }
  );
});

test("a member of someone else's workspace is not its Owner", () => {
  assert.deepEqual(
    workspaceOwnerStandingFromNamespace(
      namespace({ labels: { "user.sealos.io/owner": "alice" } }),
      "bob"
    ),
    { isOwner: false, platformDebt: false }
  );
});

test("the platform's suspension mark is debt for everyone", () => {
  for (const status of [
    "Suspend",
    "SuspendCompleted",
    "TerminateSuspend",
    "TerminateSuspendCompleted",
    "FinalDeletion",
    "FinalDeletionCompleted",
  ]) {
    assert.deepEqual(
      workspaceOwnerStandingFromNamespace(
        namespace({
          annotations: { "debt.sealos/status": status },
          labels: { "user.sealos.io/owner": "alice" },
        }),
        "bob"
      ),
      { isOwner: false, platformDebt: true },
      status
    );
  }
});

test("a resumed or normal mark is not debt", () => {
  for (const status of ["Normal", "Resume", "ResumeCompleted"]) {
    assert.equal(
      workspaceOwnerStandingFromNamespace(
        namespace({
          annotations: { "debt.sealos/status": status },
          labels: { "user.sealos.io/owner": "alice" },
        }),
        "alice"
      ).platformDebt,
      false,
      status
    );
  }
});

test("a namespace without an owner label leaves ownership unknown, never assumed", () => {
  assert.deepEqual(
    workspaceOwnerStandingFromNamespace(namespace({}), "alice"),
    { isOwner: null, platformDebt: false }
  );
});

test("an unverified caller cannot be the Owner", () => {
  assert.equal(
    workspaceOwnerStandingFromNamespace(
      namespace({ labels: { "user.sealos.io/owner": "alice" } }),
      null
    ).isOwner,
    null
  );
  assert.equal(
    workspaceOwnerStandingFromNamespace(
      namespace({ labels: { "user.sealos.io/owner": "alice" } }),
      "  "
    ).isOwner,
    null
  );
});

test("an unreadable namespace leaves both facts unknown", () => {
  assert.deepEqual(
    workspaceOwnerStandingFromNamespace(null, "alice"),
    UNKNOWN_WORKSPACE_OWNER_STANDING
  );
  assert.deepEqual(
    workspaceOwnerStandingFromNamespace({ kind: "Status", code: 403 }, "alice"),
    UNKNOWN_WORKSPACE_OWNER_STANDING
  );
});
