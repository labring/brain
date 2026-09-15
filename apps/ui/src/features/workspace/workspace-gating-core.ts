import type { WorkspaceRole } from "@/features/session/session-schema";

/**
 * The Workspace Area's gating (spec §E, mirroring Desktop's `vaildManage`
 * matrix): for each action, whether the actor sees it, sees it disabled
 * with a reason, or can use it. Two kinds of gate — a *role* gate is
 * permanent and hides the control (a Developer never invites); a *state*
 * gate lifts when a condition changes and disables the control with one
 * line saying which condition (you cannot delete the Workspace you are
 * working in). The Personal Workspace can never be deleted or transferred,
 * so those are hidden there; it can be renamed.
 *
 * A pure module: the Workspace Area and the Switcher read from it, Desktop
 * stays the authority (a stale verdict is corrected by its 403 / 404).
 */

export type WorkspaceActionGate =
  | { kind: "enabled" }
  | { kind: "disabled"; reason: string }
  | { kind: "hidden" };

export const SWITCH_FIRST_REASON = "Switch to another Workspace first.";
export const INVITE_FIRST_REASON = "Invite a member first.";

const ENABLED: WorkspaceActionGate = { kind: "enabled" };
const HIDDEN: WorkspaceActionGate = { kind: "hidden" };

function disabled(reason: string): WorkspaceActionGate {
  return { kind: "disabled", reason };
}

export interface WorkspaceGateInput {
  /** The actor's Workspace Role in the Managed Workspace. */
  actorRole: WorkspaceRole;
  /** Whether the Managed Workspace is the one the session works in. */
  isCurrent: boolean;
  isPersonal: boolean;
  /** How many members the Managed Workspace has, the actor included. */
  memberCount: number;
}

export interface WorkspaceActionGates {
  delete: WorkspaceActionGate;
  invite: WorkspaceActionGate;
  leave: WorkspaceActionGate;
  rename: WorkspaceActionGate;
  transfer: WorkspaceActionGate;
}

/** The Workspace-level actions: the detail header and the Members panel. */
export function gateWorkspaceActions(
  input: WorkspaceGateInput
): WorkspaceActionGates {
  const owner = input.actorRole === "Owner";
  const dangerous = owner && !input.isPersonal;
  // The state gate delete and leave share: never the Workspace you are in.
  const unlessCurrent = input.isCurrent
    ? disabled(SWITCH_FIRST_REASON)
    : ENABLED;
  let transfer: WorkspaceActionGate = HIDDEN;
  if (dangerous) {
    transfer = input.memberCount < 2 ? disabled(INVITE_FIRST_REASON) : ENABLED;
  }
  return {
    delete: dangerous ? unlessCurrent : HIDDEN,
    invite: input.actorRole === "Developer" ? HIDDEN : ENABLED,
    // Leaving is removing yourself; the Owner leaves only by transferring.
    leave: owner ? HIDDEN : unlessCurrent,
    rename: owner ? ENABLED : HIDDEN,
    transfer,
  };
}

export interface MemberGateInput {
  /** Whether the row is the actor's own membership. */
  isSelf: boolean;
  targetRole: WorkspaceRole;
}

export interface MemberActionGates {
  changeRole: WorkspaceActionGate;
  remove: WorkspaceActionGate;
  setAlias: WorkspaceActionGate;
}

/** The per-row actions of the members table. */
export function gateMemberActions(
  input: WorkspaceGateInput,
  member: MemberGateInput
): MemberActionGates {
  const actor = input.actorRole;
  let remove: WorkspaceActionGate = HIDDEN;
  // Nobody removes themselves here (that is "Leave") and nobody removes
  // the Owner; the Owner removes anyone else, a Manager removes Developers.
  if (!member.isSelf && member.targetRole !== "Owner") {
    if (actor === "Owner") {
      remove = ENABLED;
    } else if (actor === "Manager" && member.targetRole === "Developer") {
      remove = ENABLED;
    }
  }
  return {
    // Only the Owner changes roles, and only for other non-Owners; the
    // Owner's own role changes only through a transfer.
    changeRole:
      actor === "Owner" && !member.isSelf && member.targetRole !== "Owner"
        ? ENABLED
        : HIDDEN,
    remove,
    // Owner and Manager may set anyone's alias, the Owner's and their own included.
    setAlias: actor === "Developer" ? HIDDEN : ENABLED,
  };
}

/** The roles a change-role control offers: never Owner (spec §E.4). */
export const ASSIGNABLE_ROLES: readonly WorkspaceRole[] = [
  "Manager",
  "Developer",
];

/** The roles an actor may put on a Workspace Invite Link (spec §D.6). */
export function inviteRoleOptions(
  actorRole: WorkspaceRole
): readonly WorkspaceRole[] {
  switch (actorRole) {
    case "Owner":
      return ASSIGNABLE_ROLES;
    case "Manager":
      return ["Developer"];
    default:
      return [];
  }
}
