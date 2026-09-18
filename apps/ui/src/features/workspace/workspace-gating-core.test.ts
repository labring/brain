import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ASSIGNABLE_ROLES,
  gateMemberActions,
  gateWorkspaceActions,
  INVITE_FIRST_REASON,
  inviteRoleOptions,
  SWITCH_FIRST_REASON,
  type WorkspaceGateInput,
} from "./workspace-gating-core";

const ENABLED = { kind: "enabled" } as const;
const HIDDEN = { kind: "hidden" } as const;

const OWNER_TEAM: WorkspaceGateInput = {
  actorRole: "Owner",
  isCurrent: false,
  isPersonal: false,
  memberCount: 4,
};
const MANAGER: WorkspaceGateInput = { ...OWNER_TEAM, actorRole: "Manager" };
const DEVELOPER: WorkspaceGateInput = {
  ...OWNER_TEAM,
  actorRole: "Developer",
};
const PERSONAL: WorkspaceGateInput = {
  actorRole: "Owner",
  isCurrent: true,
  isPersonal: true,
  memberCount: 1,
};

// Spec §E.1–E.2: the Owner of a Team Workspace manages everything; the
// role gates of the others hide, the state gates disable with a reason.
test("the Owner of a Team Workspace sees every action; state gates disable with a reason", () => {
  assert.deepEqual(gateWorkspaceActions(OWNER_TEAM), {
    delete: ENABLED,
    invite: ENABLED,
    leave: HIDDEN,
    rename: ENABLED,
    transfer: ENABLED,
  });
  // Working in the Workspace: delete waits for a switch.
  assert.deepEqual(
    gateWorkspaceActions({ ...OWNER_TEAM, isCurrent: true }).delete,
    { kind: "disabled", reason: SWITCH_FIRST_REASON }
  );
  // Alone in the Workspace: transfer waits for a member.
  assert.deepEqual(
    gateWorkspaceActions({ ...OWNER_TEAM, memberCount: 1 }).transfer,
    { kind: "disabled", reason: INVITE_FIRST_REASON }
  );
});

test("a Manager invites and reads the rest; leaving waits while it is the current Workspace", () => {
  assert.deepEqual(gateWorkspaceActions(MANAGER), {
    delete: HIDDEN,
    invite: ENABLED,
    leave: ENABLED,
    rename: HIDDEN,
    transfer: HIDDEN,
  });
  assert.deepEqual(
    gateWorkspaceActions({ ...MANAGER, isCurrent: true }).leave,
    {
      kind: "disabled",
      reason: SWITCH_FIRST_REASON,
    }
  );
});

test("a Developer only reads, and can leave", () => {
  assert.deepEqual(gateWorkspaceActions(DEVELOPER), {
    delete: HIDDEN,
    invite: HIDDEN,
    leave: ENABLED,
    rename: HIDDEN,
    transfer: HIDDEN,
  });
});

test("the Personal Workspace can be renamed but never deleted, transferred, or left", () => {
  assert.deepEqual(gateWorkspaceActions(PERSONAL), {
    delete: HIDDEN,
    invite: ENABLED,
    leave: HIDDEN,
    rename: ENABLED,
    transfer: HIDDEN,
  });
  // Not the current Workspace either: still hidden, not merely disabled.
  assert.deepEqual(
    gateWorkspaceActions({ ...PERSONAL, isCurrent: false }).delete,
    HIDDEN
  );
});

// Spec §E.1, §E.3–E.4: the member rows.
test("the Owner manages every other member and never their own row or another Owner", () => {
  const others = { isSelf: false, targetRole: "Manager" } as const;
  assert.deepEqual(gateMemberActions(OWNER_TEAM, others), {
    changeRole: ENABLED,
    remove: ENABLED,
    setAlias: ENABLED,
  });
  assert.deepEqual(
    gateMemberActions(OWNER_TEAM, { isSelf: false, targetRole: "Developer" }),
    { changeRole: ENABLED, remove: ENABLED, setAlias: ENABLED }
  );
  // The Owner's own row: alias only; the role changes through transfer.
  assert.deepEqual(
    gateMemberActions(OWNER_TEAM, { isSelf: true, targetRole: "Owner" }),
    { changeRole: HIDDEN, remove: HIDDEN, setAlias: ENABLED }
  );
});

test("a Manager removes Developers, sets anyone's alias, changes nobody's role", () => {
  assert.deepEqual(
    gateMemberActions(MANAGER, { isSelf: false, targetRole: "Developer" }),
    { changeRole: HIDDEN, remove: ENABLED, setAlias: ENABLED }
  );
  assert.deepEqual(
    gateMemberActions(MANAGER, { isSelf: false, targetRole: "Manager" }),
    { changeRole: HIDDEN, remove: HIDDEN, setAlias: ENABLED }
  );
  assert.deepEqual(
    gateMemberActions(MANAGER, { isSelf: false, targetRole: "Owner" }),
    { changeRole: HIDDEN, remove: HIDDEN, setAlias: ENABLED }
  );
  // Their own row: removal is "Leave" in the header, not a row action.
  assert.deepEqual(
    gateMemberActions(MANAGER, { isSelf: true, targetRole: "Manager" }),
    { changeRole: HIDDEN, remove: HIDDEN, setAlias: ENABLED }
  );
});

test("a Developer's rows carry no action at all", () => {
  for (const targetRole of ["Owner", "Manager", "Developer"] as const) {
    for (const isSelf of [false, true]) {
      assert.deepEqual(
        gateMemberActions(DEVELOPER, { isSelf, targetRole }),
        { changeRole: HIDDEN, remove: HIDDEN, setAlias: HIDDEN },
        `${targetRole} self=${isSelf}`
      );
    }
  }
});

test("role choices never include Owner; invite roles follow the actor", () => {
  assert.deepEqual(ASSIGNABLE_ROLES, ["Manager", "Developer"]);
  assert.deepEqual(inviteRoleOptions("Owner"), ["Manager", "Developer"]);
  assert.deepEqual(inviteRoleOptions("Manager"), ["Developer"]);
  assert.deepEqual(inviteRoleOptions("Developer"), []);
});
