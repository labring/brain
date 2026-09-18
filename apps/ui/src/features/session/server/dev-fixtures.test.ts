import assert from "node:assert/strict";
import { test } from "node:test";
import {
  WORKSPACE_ROUTES,
  type WorkspaceRouteEntry,
} from "@/features/workspace/server/workspace-route-table";
import { workspaceDetailsResponseSchema } from "@/features/workspace/workspace-details-schema";
import { WORKSPACE_ERROR_CODES } from "@/features/workspace/workspace-errors";
import { workspaceListResponseSchema } from "@/features/workspace/workspace-list-schema";
import { workspaceInviteLinkResponseSchema } from "@/features/workspace/workspace-write-schema";
import {
  SESSION_DEV_SCENARIOS,
  sessionDevMockCookie,
} from "../dev-mock-cookie";

import { brainSessionSchema } from "../session-schema";
import {
  resetWorkspaceDevMockState,
  sessionDevMockResponse,
  workspaceDevMockResponse,
} from "./dev-fixtures";

function request(input: { body?: unknown; cookie?: string }): Request {
  return new Request("https://brain.test/api/session", {
    body: JSON.stringify(input.body ?? {}),
    headers: {
      "content-type": "application/json",
      ...(input.cookie == null ? {} : { cookie: input.cookie }),
    },
    method: "POST",
  });
}

test("the session mock stays out of the way without its cookie or while off", async () => {
  assert.equal(await sessionDevMockResponse(request({})), null);
  assert.equal(
    await sessionDevMockResponse(
      request({
        cookie: `${sessionDevMockCookie.name}=${sessionDevMockCookie.format({ enabled: false, scenario: "manager" })}`,
      })
    ),
    null
  );
});

// Every scenario must answer with a session the client's own schema accepts,
// staging the Workspace Role its name promises.
test("every scenario answers a valid Brain Session in the promised role", async () => {
  const expectedRole = {
    developer: "Developer",
    manager: "Manager",
    "owner-team": "Owner",
    "personal-only": "Owner",
  } as const;
  for (const scenario of SESSION_DEV_SCENARIOS) {
    const response = await sessionDevMockResponse(
      request({
        cookie: `${sessionDevMockCookie.name}=${sessionDevMockCookie.format({ enabled: true, scenario })}`,
      })
    );
    assert.notEqual(response, null, scenario);
    assert.equal(response?.status, 200, scenario);
    const session = brainSessionSchema.parse(await response?.json());
    assert.equal(session.workspace.role, expectedRole[scenario], scenario);
    assert.equal(
      session.workspace.isPersonal,
      scenario === "personal-only",
      scenario
    );
    assert.equal(session.workspaces[0]?.isPersonal, true, scenario);
    assert.equal(session.namespace, session.workspace.id, scenario);
    assert.equal(
      session.kubeconfig.includes(session.namespace),
      true,
      scenario
    );
    assert.equal(session.fallback, undefined, scenario);
  }
});

test("a requested nsid that the scenario knows is honoured; an unknown one falls back to the default with a notice", async () => {
  const cookie = `${sessionDevMockCookie.name}=${sessionDevMockCookie.format({ enabled: true, scenario: "owner-team" })}`;
  const personal = brainSessionSchema.parse(
    await (
      await sessionDevMockResponse(
        request({ body: { nsid: "ns-mock" }, cookie })
      )
    )?.json()
  );
  assert.equal(personal.workspace.isPersonal, true);
  assert.equal(personal.fallback, undefined);

  const unknown = brainSessionSchema.parse(
    await (
      await sessionDevMockResponse(
        request({ body: { nsid: "ns-elsewhere" }, cookie })
      )
    )?.json()
  );
  assert.equal(unknown.fallback, "not_member");
  assert.equal(unknown.workspace.isPersonal, true);
});

// Spec §B.4: the same scenario answers every Workspace route, with the list
// the session itself staged, so the Switcher's refresh never disagrees
// with the session it started from.
test("every scenario answers every Workspace route with the session's own list", async () => {
  for (const scenario of SESSION_DEV_SCENARIOS) {
    const cookie = `${sessionDevMockCookie.name}=${sessionDevMockCookie.format({ enabled: true, scenario })}`;
    const session = brainSessionSchema.parse(
      await (await sessionDevMockResponse(request({ cookie })))?.json()
    );
    for (const entry of Object.values(WORKSPACE_ROUTES)) {
      // A write that lands (delete, say) must not shape the next route's read.
      resetWorkspaceDevMockState();
      const response = await workspaceDevMockResponse(
        entry.desktopPath,
        new Request(`https://brain.test${entry.apiPath}`, {
          body: JSON.stringify({ uid: session.workspace.uid }),
          headers: { "content-type": "application/json", cookie },
          method: "POST",
        })
      );
      // The read routes answer 200; a write route with a body this bare
      // answers its own 400, never the 501 of a missing fixture.
      assert.notEqual(response?.status, 501, `${scenario} ${entry.apiPath}`);
      if (
        entry === WORKSPACE_ROUTES.list ||
        entry === WORKSPACE_ROUTES.details
      ) {
        assert.equal(response?.status, 200, `${scenario} ${entry.apiPath}`);
      }
      if (entry === WORKSPACE_ROUTES.list) {
        assert.deepEqual(
          workspaceListResponseSchema.parse(await response?.json()),
          session.workspaces,
          scenario
        );
      }
      if (entry === WORKSPACE_ROUTES.details) {
        // The staged Workspace's members, with the mock user in the role
        // the session gave them, so the Workspace Area gates as staged.
        const details = workspaceDetailsResponseSchema.parse(
          await response?.json()
        );
        assert.deepEqual(details.workspace, session.workspace, scenario);
        const me = details.members.find(
          (candidate) => candidate.crName === session.user.crName
        );
        assert.equal(me?.role, session.workspace.role, scenario);
        assert.equal(
          details.members.filter((candidate) => candidate.role === "Owner")
            .length,
          1,
          `${scenario} has exactly one Owner`
        );
      }
    }
    // Every Workspace in the list has a details answer, not just the staged one.
    for (const workspace of session.workspaces) {
      const response = await workspaceDevMockResponse(
        WORKSPACE_ROUTES.details.desktopPath,
        new Request("https://brain.test/api/workspace/details", {
          body: JSON.stringify({ uid: workspace.uid }),
          headers: { "content-type": "application/json", cookie },
          method: "POST",
        })
      );
      const details = workspaceDetailsResponseSchema.parse(
        await response?.json()
      );
      assert.equal(details.workspace.uid, workspace.uid, scenario);
      assert.ok(
        details.members.some(
          (candidate) => candidate.crName === session.user.crName
        ),
        `${scenario} ${workspace.name} lists the mock user`
      );
    }
  }
  // A uid outside the scenario's list is Desktop's 404, translated.
  const unknown = await workspaceDevMockResponse(
    WORKSPACE_ROUTES.details.desktopPath,
    new Request("https://brain.test/api/workspace/details", {
      body: JSON.stringify({ uid: "00000000-0000-4000-8000-0000000000ff" }),
      headers: {
        "content-type": "application/json",
        cookie: `${sessionDevMockCookie.name}=${sessionDevMockCookie.format({ enabled: true, scenario: "owner-team" })}`,
      },
      method: "POST",
    })
  );
  assert.equal(unknown?.status, 404);
  assert.deepEqual(await unknown?.json(), {
    error: WORKSPACE_ERROR_CODES.notFound,
  });
  assert.equal(
    await workspaceDevMockResponse(
      WORKSPACE_ROUTES.list.desktopPath,
      new Request("https://brain.test/api/workspace/list")
    ),
    null
  );
});

// Spec §B.4: the writes take effect in memory, so the Workspace Area can be
// driven end to end against the mock — and the session and list agree with
// what was written.
const OWNER_COOKIE = `${sessionDevMockCookie.name}=${sessionDevMockCookie.format({ enabled: true, scenario: "owner-team" })}`;
const ACME_UID = "00000000-0000-4000-8000-000000000002";

async function write(
  entry: WorkspaceRouteEntry,
  body: unknown,
  cookie = OWNER_COOKIE
): Promise<Response> {
  const response = await workspaceDevMockResponse(
    entry.desktopPath,
    new Request(`https://brain.test${entry.apiPath}`, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", cookie },
      method: "POST",
    })
  );
  assert.ok(response);
  return response;
}

async function readDetails(uid: string, cookie = OWNER_COOKIE) {
  return workspaceDetailsResponseSchema.parse(
    await (await write(WORKSPACE_ROUTES.details, { uid }, cookie)).json()
  );
}

async function readList(cookie = OWNER_COOKIE) {
  return workspaceListResponseSchema.parse(
    await (await write(WORKSPACE_ROUTES.list, {}, cookie)).json()
  );
}

test("dev-mock writes: rename, role, alias, and remove take effect for the next read", async () => {
  resetWorkspaceDevMockState();
  assert.equal(
    (
      await write(WORKSPACE_ROUTES.rename, {
        name: "Acme Robotics",
        uid: ACME_UID,
      })
    ).status,
    200
  );
  assert.equal(
    (await readList()).find((w) => w.uid === ACME_UID)?.name,
    "Acme Robotics"
  );
  const session = brainSessionSchema.parse(
    await (
      await sessionDevMockResponse(request({ cookie: OWNER_COOKIE }))
    )?.json()
  );
  assert.equal(session.workspace.name, "Acme Robotics");

  assert.equal(
    (
      await write(WORKSPACE_ROUTES.memberRole, {
        crUid: "cr-chen",
        role: "Manager",
        uid: ACME_UID,
      })
    ).status,
    200
  );
  assert.equal(
    (await readDetails(ACME_UID)).members.find((m) => m.crUid === "cr-chen")
      ?.role,
    "Manager"
  );

  await write(WORKSPACE_ROUTES.memberAlias, {
    alias: "  Platform  ",
    crUid: "cr-chen",
    uid: ACME_UID,
  });
  assert.equal(
    (await readDetails(ACME_UID)).members.find((m) => m.crUid === "cr-chen")
      ?.alias,
    "Platform"
  );
  await write(WORKSPACE_ROUTES.memberAlias, {
    alias: "",
    crUid: "cr-chen",
    uid: ACME_UID,
  });
  assert.equal(
    (await readDetails(ACME_UID)).members.find((m) => m.crUid === "cr-chen")
      ?.alias,
    null
  );

  assert.equal(
    (
      await write(WORKSPACE_ROUTES.memberRemove, {
        crUid: "cr-chen",
        uid: ACME_UID,
      })
    ).status,
    200
  );
  assert.equal(
    (await readDetails(ACME_UID)).members.some((m) => m.crUid === "cr-chen"),
    false
  );
  resetWorkspaceDevMockState();
});

test("dev-mock writes: transfer demotes the mock user, delete and leave drop the Workspace from the list", async () => {
  resetWorkspaceDevMockState();
  assert.equal(
    (await write(WORKSPACE_ROUTES.transfer, { crUid: "cr-lin", uid: ACME_UID }))
      .status,
    200
  );
  const afterTransfer = await readDetails(ACME_UID);
  assert.equal(
    afterTransfer.members.find((m) => m.crUid === "cr-lin")?.role,
    "Owner"
  );
  assert.equal(
    afterTransfer.members.find((m) => m.crUid === "cr-mock")?.role,
    "Developer"
  );
  assert.equal(
    (await readList()).find((w) => w.uid === ACME_UID)?.role,
    "Developer"
  );
  // No longer the Owner: delete is Desktop's 403, translated.
  assert.equal(
    (await write(WORKSPACE_ROUTES.delete, { uid: ACME_UID })).status,
    403
  );
  // Leaving is removing yourself.
  assert.equal(
    (
      await write(WORKSPACE_ROUTES.memberRemove, {
        crUid: "cr-mock",
        uid: ACME_UID,
      })
    ).status,
    200
  );
  assert.equal(
    (await readList()).some((w) => w.uid === ACME_UID),
    false
  );
  assert.equal(
    (await write(WORKSPACE_ROUTES.details, { uid: ACME_UID })).status,
    404
  );

  resetWorkspaceDevMockState();
  const SANDBOX_UID = "00000000-0000-4000-8000-000000000003";
  // The mock user is a Developer in Sandbox: no delete.
  assert.equal(
    (await write(WORKSPACE_ROUTES.delete, { uid: SANDBOX_UID })).status,
    403
  );
  assert.equal(
    (await write(WORKSPACE_ROUTES.delete, { uid: ACME_UID })).status,
    200
  );
  assert.deepEqual(
    (await readList()).map((w) => w.uid),
    ["00000000-0000-4000-8000-000000000001", SANDBOX_UID]
  );
  resetWorkspaceDevMockState();
});

test("dev-mock writes: an invite link answers a code, and the role matrix holds", async () => {
  resetWorkspaceDevMockState();
  const link = await write(WORKSPACE_ROUTES.inviteLink, {
    role: "Manager",
    uid: ACME_UID,
  });
  assert.equal(link.status, 200);
  const { code } = workspaceInviteLinkResponseSchema.parse(await link.json());
  assert.ok(code.length > 8);

  const manager = `${sessionDevMockCookie.name}=${sessionDevMockCookie.format({ enabled: true, scenario: "manager" })}`;
  assert.equal(
    (
      await write(
        WORKSPACE_ROUTES.rename,
        { name: "X", uid: ACME_UID },
        manager
      )
    ).status,
    403
  );
  assert.equal(
    (
      await write(
        WORKSPACE_ROUTES.inviteLink,
        { role: "Developer", uid: ACME_UID },
        manager
      )
    ).status,
    200
  );
  // A Manager never mints a Manager link — the same Owner proof the route
  // handler runs against `namespace/list`.
  assert.equal(
    (
      await write(
        WORKSPACE_ROUTES.inviteLink,
        { role: "Manager", uid: ACME_UID },
        manager
      )
    ).status,
    403
  );
  // A Manager removes Developers only.
  assert.equal(
    (
      await write(
        WORKSPACE_ROUTES.memberRemove,
        { crUid: "cr-yu", uid: ACME_UID },
        manager
      )
    ).status,
    403
  );
  assert.equal(
    (
      await write(
        WORKSPACE_ROUTES.memberRemove,
        { crUid: "cr-qi", uid: ACME_UID },
        manager
      )
    ).status,
    200
  );
  resetWorkspaceDevMockState();
});
