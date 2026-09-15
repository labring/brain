import assert from "node:assert/strict";
import { test } from "node:test";

import {
  SESSION_DEV_SCENARIOS,
  sessionDevMockCookie,
} from "../dev-mock-cookie";
import { brainSessionSchema } from "../session-schema";
import { sessionDevMockResponse } from "./dev-fixtures";

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
  assert.equal(unknown.workspace.name, "Acme");
});
