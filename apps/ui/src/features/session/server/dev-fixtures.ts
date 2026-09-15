import { resolveDevMock } from "@/features/dev-mock/server/resolve";
import { WORKSPACE_ROUTES } from "@/features/workspace/server/workspace-route-table";
import {
  type WorkspaceDetailsResponse,
  type WorkspaceMember,
  workspaceDetailsRequestSchema,
} from "@/features/workspace/workspace-details-schema";
import { WORKSPACE_ERROR_CODES } from "@/features/workspace/workspace-errors";
import {
  gateMemberActions,
  gateWorkspaceActions,
} from "@/features/workspace/workspace-gating-core";
import {
  type WorkspaceInviteLinkResponse,
  type WorkspaceWriteResponse,
  workspaceDeleteRequestSchema,
  workspaceInviteLinkRequestSchema,
  workspaceMemberAliasRequestSchema,
  workspaceMemberRemoveRequestSchema,
  workspaceMemberRoleRequestSchema,
  workspaceRenameRequestSchema,
  workspaceTransferRequestSchema,
} from "@/features/workspace/workspace-write-schema";
import {
  type SessionDevScenario,
  sessionDevMockCookie,
} from "../dev-mock-cookie";
import type {
  BrainSession,
  SessionWorkspace,
  WorkspaceRole,
} from "../session-schema";

/**
 * Session dev-mock fixtures (dev and demo builds only): one Brain Session
 * per scenario, each staging a Workspace Role the shell must gate on. The
 * credentials are inert fakes — a kubeconfig no apiserver accepts, tokens
 * no verifier signs — so a mock session can never reach a real cluster or
 * account; the other Dev Mocks answer the routes that would consume them.
 * The same scenario answers the `/api/workspace/*` routes (spec §B.4), so
 * the Switcher's list refresh agrees with the session it was staged from;
 * the write routes change the scenario's state in memory (for the process's
 * lifetime), so a rename, a role change, a removal, a transfer, or a delete
 * shows on the next read exactly as it would against Desktop.
 */

const MOCK_KUBECONFIG = (namespace: string) => `apiVersion: v1
kind: Config
current-context: mock
contexts:
  - name: mock
    context:
      cluster: mock
      user: mock
      namespace: ${namespace}
clusters:
  - name: mock
    cluster:
      server: https://mock.invalid
users:
  - name: mock
    user:
      token: mock-token
`;

const PERSONAL: SessionWorkspace = {
  createdAt: "2026-01-05T09:00:00.000Z",
  id: "ns-mock",
  isPersonal: true,
  name: "private team",
  role: "Owner",
  uid: "00000000-0000-4000-8000-000000000001",
};

const ACME = (role: SessionWorkspace["role"]): SessionWorkspace => ({
  createdAt: "2026-02-14T09:00:00.000Z",
  id: "ns-mockacme",
  isPersonal: false,
  name: "Acme",
  role,
  uid: "00000000-0000-4000-8000-000000000002",
});

const SANDBOX: SessionWorkspace = {
  createdAt: "2026-03-01T09:00:00.000Z",
  id: "ns-mocksand",
  isPersonal: false,
  name: "Sandbox",
  role: "Developer",
  uid: "00000000-0000-4000-8000-000000000003",
};

const MOCK_USER = {
  avatar: "",
  crName: "mock",
  name: "Mock User",
  userId: "mock-user",
  userUid: "00000000-0000-4000-8000-00000000aaaa",
};

function member(
  crUid: string,
  nickname: string,
  role: WorkspaceMember["role"],
  joinedAt: string,
  alias: string | null = null
): WorkspaceMember {
  return {
    alias,
    avatarUrl: "",
    crName: crUid === "cr-mock" ? MOCK_USER.crName : crUid.replace("cr-", ""),
    crUid,
    joinedAt,
    nickname,
    role,
    userUid: crUid === "cr-mock" ? MOCK_USER.userUid : `uid-${crUid}`,
  };
}

const ME = (role: WorkspaceMember["role"], joinedAt: string) =>
  member("cr-mock", MOCK_USER.name, role, joinedAt);

/**
 * The members of each Workspace per scenario (spec §B.4): the mock user
 * holds the role the scenario names, beside enough other members that
 * every gate in the Workspace Area has a row to act on — an Owner to
 * protect, a Manager, Developers with and without an alias.
 */
function seedMembersFor(
  scenario: SessionDevScenario,
  workspaceUid: string
): WorkspaceMember[] {
  if (workspaceUid === PERSONAL.uid) {
    return [ME("Owner", PERSONAL.createdAt)];
  }
  if (workspaceUid === SANDBOX.uid) {
    return [
      member("cr-kai", "Kai", "Owner", "2026-03-01T09:00:00.000Z"),
      member(
        "cr-ming",
        "Ming",
        "Manager",
        "2026-03-02T09:00:00.000Z",
        "Docs PM"
      ),
      ME("Developer", "2026-03-05T09:00:00.000Z"),
      member("cr-su", "Su Lan", "Developer", "2026-05-18T09:00:00.000Z"),
    ];
  }
  switch (scenario) {
    case "owner-team":
      return [
        ME("Owner", ACME("Owner").createdAt),
        member(
          "cr-lin",
          "Lin Wei",
          "Manager",
          "2026-02-20T09:00:00.000Z",
          "Frontend lead"
        ),
        member("cr-chen", "Chen Jie", "Developer", "2026-04-11T09:00:00.000Z"),
        member(
          "cr-zhao",
          "zhao.xiaoming",
          "Developer",
          "2026-07-01T09:00:00.000Z",
          "Summer intern"
        ),
      ];
    case "manager":
      return [
        member("cr-rui", "Rui", "Owner", ACME("Owner").createdAt),
        ME("Manager", "2026-02-15T09:00:00.000Z"),
        member("cr-yu", "Yu", "Manager", "2026-02-25T09:00:00.000Z"),
        member("cr-qi", "Qi", "Developer", "2026-07-30T09:00:00.000Z"),
      ];
    default:
      return [
        member("cr-kai", "Kai", "Owner", ACME("Owner").createdAt),
        member(
          "cr-ming",
          "Ming",
          "Manager",
          "2026-02-15T09:00:00.000Z",
          "Docs PM"
        ),
        ME("Developer", "2026-03-05T09:00:00.000Z"),
        member("cr-su", "Su Lan", "Developer", "2026-05-18T09:00:00.000Z"),
      ];
  }
}

function seedWorkspacesFor(scenario: SessionDevScenario): SessionWorkspace[] {
  switch (scenario) {
    case "personal-only":
      return [PERSONAL];
    case "owner-team":
      return [PERSONAL, ACME("Owner"), SANDBOX];
    case "manager":
      return [PERSONAL, ACME("Manager")];
    default:
      return [PERSONAL, ACME("Developer")];
  }
}

/**
 * A scenario's mutable state: the list and each Workspace's members, seeded
 * from the fixtures on first use and changed by the write fixtures. Lives
 * for the dev server's process; `resetWorkspaceDevMockState` puts every
 * scenario back to its seed (tests, and a dev tweak if one is ever wanted).
 */
interface ScenarioState {
  members: Map<string, WorkspaceMember[]>;
  workspaces: SessionWorkspace[];
}

const scenarioStates = new Map<SessionDevScenario, ScenarioState>();

function stateFor(scenario: SessionDevScenario): ScenarioState {
  let state = scenarioStates.get(scenario);
  if (state == null) {
    const workspaces = seedWorkspacesFor(scenario);
    state = {
      members: new Map(
        workspaces.map((workspace) => [
          workspace.uid,
          seedMembersFor(scenario, workspace.uid),
        ])
      ),
      workspaces,
    };
    scenarioStates.set(scenario, state);
  }
  return state;
}

export function resetWorkspaceDevMockState(): void {
  scenarioStates.clear();
}

function workspacesFor(scenario: SessionDevScenario): SessionWorkspace[] {
  return stateFor(scenario).workspaces;
}

function membersFor(
  scenario: SessionDevScenario,
  workspaceUid: string
): WorkspaceMember[] {
  return stateFor(scenario).members.get(workspaceUid) ?? [];
}

function sessionFor(
  scenario: SessionDevScenario,
  requestedNsid: string | null
): BrainSession {
  const workspaces = workspacesFor(scenario);
  const requested =
    requestedNsid == null
      ? null
      : workspaces.find((workspace) => workspace.id === requestedNsid);
  // Without a nsid (no Desktop shell, no Dev Bridge) the mock stages the
  // scenario's Team Workspace so its role can be seen; a nsid it does not
  // know lands in Personal with the notice, exactly like the real path.
  const staged = workspaces[1] ?? PERSONAL;
  const current = requested ?? (requestedNsid == null ? staged : PERSONAL);
  return {
    appToken: `mock-app-token-${scenario}`,
    ...(requestedNsid != null && requested == null
      ? { fallback: "not_member" as const }
      : {}),
    kubeconfig: MOCK_KUBECONFIG(current.id),
    namespace: current.id,
    regionalToken: `mock-regional-token-${scenario}`,
    user: MOCK_USER,
    workspace: current,
    workspaces,
  };
}

export async function sessionDevMockResponse(
  request: Request
): Promise<Response | null> {
  const resolution = resolveDevMock(sessionDevMockCookie, request, "session");
  if (resolution.kind === "off") {
    return null;
  }
  if (resolution.kind === "invalid") {
    return resolution.response;
  }
  const payload: unknown = await request.json().catch(() => null);
  const nsid =
    typeof payload === "object" &&
    payload != null &&
    "nsid" in payload &&
    typeof payload.nsid === "string" &&
    payload.nsid.trim() !== ""
      ? payload.nsid.trim()
      : null;
  return Response.json(sessionFor(resolution.scenario, nsid), {
    headers: { "cache-control": "no-store" },
  });
}

function mockJson(payload: unknown, status = 200): Response {
  return Response.json(payload, {
    headers: { "cache-control": "no-store" },
    status,
  });
}

async function detailsFixture(
  scenario: SessionDevScenario,
  request: Request
): Promise<Response> {
  const payload: unknown = await request.json().catch(() => null);
  const parsed = workspaceDetailsRequestSchema.safeParse(payload ?? {});
  if (!parsed.success) {
    return mockJson({ error: WORKSPACE_ERROR_CODES.invalidRequest }, 400);
  }
  const workspace = workspacesFor(scenario).find(
    (candidate) => candidate.uid === parsed.data.uid
  );
  if (workspace == null) {
    // Desktop answers 404 for a Workspace the caller is not in.
    return mockJson({ error: WORKSPACE_ERROR_CODES.notFound }, 404);
  }
  const details: WorkspaceDetailsResponse = {
    members: membersFor(scenario, workspace.uid),
    workspace,
  };
  return mockJson(details);
}

const WRITE_OK: WorkspaceWriteResponse = { ok: true };

type WriteOutcome =
  | { kind: "ok"; body?: unknown }
  | { kind: "error"; code: string; status: number };

const FORBIDDEN: WriteOutcome = {
  code: WORKSPACE_ERROR_CODES.forbidden,
  kind: "error",
  status: 403,
};
const NOT_FOUND: WriteOutcome = {
  code: WORKSPACE_ERROR_CODES.notFound,
  kind: "error",
  status: 404,
};

function outcomeResponse(outcome: WriteOutcome): Response {
  return outcome.kind === "ok"
    ? mockJson(outcome.body ?? WRITE_OK)
    : mockJson({ error: outcome.code }, outcome.status);
}

/** The mock user's own membership row and role in a Workspace of the scenario. */
function actorIn(
  scenario: SessionDevScenario,
  workspaceUid: string
): { role: WorkspaceRole; workspace: SessionWorkspace } | null {
  const workspace = workspacesFor(scenario).find(
    (candidate) => candidate.uid === workspaceUid
  );
  return workspace == null ? null : { role: workspace.role, workspace };
}

function replaceWorkspace(
  state: ScenarioState,
  uid: string,
  patch: Partial<SessionWorkspace>
): void {
  state.workspaces = state.workspaces.map((workspace) =>
    workspace.uid === uid ? { ...workspace, ...patch } : workspace
  );
}

function patchMember(
  state: ScenarioState,
  workspaceUid: string,
  crUid: string,
  patch: Partial<WorkspaceMember>
): void {
  state.members.set(
    workspaceUid,
    membersOf(state, workspaceUid).map((member) =>
      member.crUid === crUid ? { ...member, ...patch } : member
    )
  );
}

function membersOf(state: ScenarioState, workspaceUid: string) {
  return state.members.get(workspaceUid) ?? [];
}

function dropWorkspace(state: ScenarioState, uid: string): void {
  state.workspaces = state.workspaces.filter(
    (workspace) => workspace.uid !== uid
  );
  state.members.delete(uid);
}

/**
 * The write fixtures apply Desktop's own rules (spec §E, the same gating
 * module the page reads) to the scenario's state: what the page hides or
 * disables, Desktop refuses, so a stale page meets the same 403 / 404 here
 * as in staging. Bodies are validated with the routes' own schemas.
 */
function writeFixture<TBody>(
  schema: {
    safeParse: (
      payload: unknown
    ) => { success: true; data: TBody } | { success: false };
  },
  apply: (
    scenario: SessionDevScenario,
    state: ScenarioState,
    body: TBody
  ) => WriteOutcome
) {
  return async (
    scenario: SessionDevScenario,
    request: Request
  ): Promise<Response> => {
    const payload: unknown = await request.json().catch(() => null);
    const parsed = schema.safeParse(payload ?? {});
    if (!parsed.success) {
      return mockJson({ error: WORKSPACE_ERROR_CODES.invalidRequest }, 400);
    }
    return outcomeResponse(apply(scenario, stateFor(scenario), parsed.data));
  };
}

/** The Workspace-level gates as Desktop judges them (no "current" here: Desktop's own check is UI-gated). */
function workspaceGates(scenario: SessionDevScenario, uid: string) {
  const actor = actorIn(scenario, uid);
  if (actor == null) {
    return null;
  }
  return gateWorkspaceActions({
    actorRole: actor.role,
    isCurrent: false,
    isPersonal: actor.workspace.isPersonal,
    memberCount: membersFor(scenario, uid).length,
  });
}

const WORKSPACE_FIXTURES: Record<
  string,
  (scenario: SessionDevScenario, request: Request) => Promise<Response>
> = {
  [WORKSPACE_ROUTES.details.desktopPath]: detailsFixture,
  [WORKSPACE_ROUTES.list.desktopPath]: (scenario) =>
    Promise.resolve(mockJson(workspacesFor(scenario))),
  [WORKSPACE_ROUTES.rename.desktopPath]: writeFixture(
    workspaceRenameRequestSchema,
    (scenario, state, body) => {
      const gates = workspaceGates(scenario, body.uid);
      if (gates == null) {
        return NOT_FOUND;
      }
      if (gates.rename.kind !== "enabled") {
        return FORBIDDEN;
      }
      replaceWorkspace(state, body.uid, { name: body.name });
      return { kind: "ok" };
    }
  ),
  [WORKSPACE_ROUTES.delete.desktopPath]: writeFixture(
    workspaceDeleteRequestSchema,
    (scenario, state, body) => {
      const gates = workspaceGates(scenario, body.uid);
      if (gates == null) {
        return NOT_FOUND;
      }
      if (gates.delete.kind !== "enabled") {
        return FORBIDDEN;
      }
      dropWorkspace(state, body.uid);
      return { kind: "ok" };
    }
  ),
  [WORKSPACE_ROUTES.inviteLink.desktopPath]: writeFixture(
    workspaceInviteLinkRequestSchema,
    (scenario, _state, body) => {
      const gates = workspaceGates(scenario, body.uid);
      if (gates == null) {
        return NOT_FOUND;
      }
      if (gates.invite.kind !== "enabled") {
        return FORBIDDEN;
      }
      const response: WorkspaceInviteLinkResponse = {
        code: `mock-${body.role.toLowerCase()}-${crypto.randomUUID()}`,
      };
      return { body: response, kind: "ok" };
    }
  ),
  [WORKSPACE_ROUTES.memberRemove.desktopPath]: writeFixture(
    workspaceMemberRemoveRequestSchema,
    (scenario, state, body) => {
      const actor = actorIn(scenario, body.uid);
      if (actor == null) {
        return FORBIDDEN;
      }
      const target = membersOf(state, body.uid).find(
        (member) => member.crUid === body.crUid
      );
      if (target == null) {
        return NOT_FOUND;
      }
      const isSelf = target.crName === MOCK_USER.crName;
      if (isSelf) {
        // Leaving: any non-Owner may; the Owner leaves only by transferring.
        if (actor.role === "Owner") {
          return FORBIDDEN;
        }
        dropWorkspace(state, body.uid);
        return { kind: "ok" };
      }
      const gates = gateMemberActions(
        {
          actorRole: actor.role,
          isCurrent: false,
          isPersonal: actor.workspace.isPersonal,
          memberCount: membersOf(state, body.uid).length,
        },
        { isSelf, targetRole: target.role }
      );
      if (gates.remove.kind !== "enabled") {
        return FORBIDDEN;
      }
      state.members.set(
        body.uid,
        membersOf(state, body.uid).filter(
          (member) => member.crUid !== body.crUid
        )
      );
      return { kind: "ok" };
    }
  ),
  [WORKSPACE_ROUTES.memberRole.desktopPath]: writeFixture(
    workspaceMemberRoleRequestSchema,
    (scenario, state, body) => {
      const actor = actorIn(scenario, body.uid);
      if (actor == null) {
        return FORBIDDEN;
      }
      const target = membersOf(state, body.uid).find(
        (member) => member.crUid === body.crUid
      );
      if (target == null) {
        return NOT_FOUND;
      }
      const gates = gateMemberActions(
        {
          actorRole: actor.role,
          isCurrent: false,
          isPersonal: actor.workspace.isPersonal,
          memberCount: membersOf(state, body.uid).length,
        },
        { isSelf: target.crName === MOCK_USER.crName, targetRole: target.role }
      );
      if (gates.changeRole.kind !== "enabled") {
        return FORBIDDEN;
      }
      patchMember(state, body.uid, body.crUid, { role: body.role });
      return { kind: "ok" };
    }
  ),
  [WORKSPACE_ROUTES.memberAlias.desktopPath]: writeFixture(
    workspaceMemberAliasRequestSchema,
    (scenario, state, body) => {
      const actor = actorIn(scenario, body.uid);
      if (actor == null) {
        return FORBIDDEN;
      }
      if (actor.role === "Developer") {
        return FORBIDDEN;
      }
      const target = membersOf(state, body.uid).find(
        (member) => member.crUid === body.crUid
      );
      if (target == null) {
        return NOT_FOUND;
      }
      patchMember(state, body.uid, body.crUid, { alias: body.alias });
      return { kind: "ok" };
    }
  ),
  [WORKSPACE_ROUTES.transfer.desktopPath]: writeFixture(
    workspaceTransferRequestSchema,
    (scenario, state, body) => {
      const gates = workspaceGates(scenario, body.uid);
      if (gates == null) {
        return FORBIDDEN;
      }
      if (gates.transfer.kind !== "enabled") {
        return FORBIDDEN;
      }
      const target = membersOf(state, body.uid).find(
        (member) => member.crUid === body.crUid
      );
      if (target == null) {
        return NOT_FOUND;
      }
      if (target.crName === MOCK_USER.crName) {
        return {
          code: WORKSPACE_ERROR_CODES.conflict,
          kind: "error",
          status: 409,
        };
      }
      // Desktop's `abdicate`: the target becomes Owner, the old Owner a Developer.
      const me = membersOf(state, body.uid).find(
        (member) => member.crName === MOCK_USER.crName
      );
      patchMember(state, body.uid, body.crUid, { role: "Owner" });
      if (me != null) {
        patchMember(state, body.uid, me.crUid, { role: "Developer" });
      }
      replaceWorkspace(state, body.uid, { role: "Developer" });
      return { kind: "ok" };
    }
  ),
};

/** Answers a `/api/workspace/*` route by its Desktop path from the scenario. */
export function workspaceDevMockResponse(
  desktopPath: string,
  request: Request
): Promise<Response | null> {
  const resolution = resolveDevMock(sessionDevMockCookie, request, "session");
  if (resolution.kind === "off") {
    return Promise.resolve(null);
  }
  if (resolution.kind === "invalid") {
    return Promise.resolve(resolution.response);
  }
  const fixture = WORKSPACE_FIXTURES[desktopPath];
  if (fixture == null) {
    return Promise.resolve(
      Response.json(
        {
          error: `Session mock mode does not support this operation (${desktopPath} has no fixture).`,
        },
        { status: 501 }
      )
    );
  }
  return fixture(resolution.scenario, request);
}
