import assert from "node:assert/strict";
import { test } from "node:test";

import type { SessionWorkspace } from "@/features/session/session-schema";

import {
  resolveManagedWorkspace,
  WORKSPACE_NOT_IN_LIST_NOTICE,
  workspaceAreaPath,
} from "./workspace-area-route-core";

const PERSONAL: SessionWorkspace = {
  createdAt: "2026-01-05T09:00:00.000Z",
  id: "ns-personal",
  isPersonal: true,
  name: "private team",
  role: "Owner",
  uid: "uid-personal",
};
const ACME: SessionWorkspace = {
  createdAt: "2026-02-14T09:00:00.000Z",
  id: "ns-acme",
  isPersonal: false,
  name: "Acme",
  role: "Manager",
  uid: "uid-acme",
};
const WORKSPACES = [PERSONAL, ACME];

test("/workspace replaces itself with the current Workspace, silently", () => {
  assert.deepEqual(
    resolveManagedWorkspace({
      currentUid: ACME.uid,
      uid: null,
      workspaces: WORKSPACES,
    }),
    { kind: "redirect", notice: null, to: "/workspace/uid-acme" }
  );
  assert.deepEqual(
    resolveManagedWorkspace({
      currentUid: ACME.uid,
      uid: "",
      workspaces: WORKSPACES,
    }),
    { kind: "redirect", notice: null, to: "/workspace/uid-acme" }
  );
});

test("a uid in the list is the Managed Workspace, whether or not it is the current one", () => {
  assert.deepEqual(
    resolveManagedWorkspace({
      currentUid: ACME.uid,
      uid: PERSONAL.uid,
      workspaces: WORKSPACES,
    }),
    { kind: "managed", workspace: PERSONAL }
  );
  assert.deepEqual(
    resolveManagedWorkspace({
      currentUid: ACME.uid,
      uid: ACME.uid,
      workspaces: WORKSPACES,
    }),
    { kind: "managed", workspace: ACME }
  );
});

test("a uid outside the list falls back to the current Workspace with a notice", () => {
  assert.deepEqual(
    resolveManagedWorkspace({
      currentUid: ACME.uid,
      uid: "uid-elsewhere",
      workspaces: WORKSPACES,
    }),
    {
      kind: "redirect",
      notice: WORKSPACE_NOT_IN_LIST_NOTICE,
      to: "/workspace/uid-acme",
    }
  );
});

test("nothing is judged before the session names a current Workspace", () => {
  assert.deepEqual(
    resolveManagedWorkspace({
      currentUid: null,
      uid: "uid-elsewhere",
      workspaces: [],
    }),
    { kind: "pending" }
  );
});

test("the area path URL-encodes the uid", () => {
  assert.equal(workspaceAreaPath("a b/c"), "/workspace/a%20b%2Fc");
});
