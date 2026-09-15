import assert from "node:assert/strict";
import { test } from "node:test";
import { WORKSPACE_ROUTES } from "@/features/workspace/server/workspace-route-table";
import { workspaceListResponseSchema } from "@/features/workspace/workspace-list-schema";
import {
  SESSION_DEV_SCENARIOS,
  sessionDevMockCookie,
} from "../dev-mock-cookie";

import { brainSessionSchema } from "../session-schema";
import {
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
      const response = await workspaceDevMockResponse(
        entry.desktopPath,
        new Request(`https://brain.test${entry.apiPath}`, {
          headers: { cookie },
        })
      );
      assert.equal(response?.status, 200, `${scenario} ${entry.apiPath}`);
      if (entry === WORKSPACE_ROUTES.list) {
        assert.deepEqual(
          workspaceListResponseSchema.parse(await response?.json()),
          session.workspaces,
          scenario
        );
      }
    }
  }
  assert.equal(
    await workspaceDevMockResponse(
      WORKSPACE_ROUTES.list.desktopPath,
      new Request("https://brain.test/api/workspace/list")
    ),
    null
  );
});
