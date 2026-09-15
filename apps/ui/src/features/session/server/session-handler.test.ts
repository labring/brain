import { describe, expect, it, mock } from "bun:test";

import { namespaceFromKubeconfigText } from "@/lib/kubeconfig-namespace-core";

import { brainSessionSchema } from "../session-schema";

mock.module("server-only", () => ({}));
const { createSessionHandler } = await import("./session-handler");
const {
  createFakeDesktop,
  defaultDesktopAnswers,
  GLOBAL_TOKEN,
  PERSONAL,
  PERSONAL_APP_TOKEN,
  PERSONAL_REGIONAL_TOKEN,
  TEAM,
  TEAM_APP_TOKEN,
  TEAM_REGIONAL_TOKEN,
} = await import("./desktop-test-double");

const DEV_ENV = {
  DESKTOP_API_BASE_URL: "http://sealos-desktop.sealos.svc:3000",
  NODE_ENV: "development",
};

function sessionRequest(input: {
  body?: unknown;
  cookie?: string | null;
}): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (input.cookie !== null) {
    headers.cookie =
      input.cookie ?? `other=1; sealos_auth_token=${GLOBAL_TOKEN}; theme=dark`;
  }
  return new Request("https://brain.test/api/session", {
    body: JSON.stringify(input.body ?? {}),
    headers,
    method: "POST",
  });
}

interface LogEntry {
  fields: Record<string, unknown>;
  message: string;
}

function handlerWith(
  answers = defaultDesktopAnswers(),
  env: Record<string, string | undefined> = DEV_ENV
) {
  const desktop = createFakeDesktop({ answers });
  const logs: LogEntry[] = [];
  const handler = createSessionHandler({
    env,
    fetchDesktop: desktop.fetch,
    log: (message, fields) => logs.push({ fields, message }),
  });
  return { calls: desktop.calls, handler, logs };
}

const SECRET_VALUES = [
  GLOBAL_TOKEN,
  PERSONAL_REGIONAL_TOKEN,
  TEAM_REGIONAL_TOKEN,
  PERSONAL_APP_TOKEN,
  TEAM_APP_TOKEN,
  "sa-token-abc12345",
];

function expectNoTokenInLogs(logs: LogEntry[]) {
  const serialized = JSON.stringify(logs);
  for (const secret of SECRET_VALUES) {
    expect(serialized.includes(secret)).toBe(false);
  }
}

describe("POST /api/session", () => {
  it("lands a Team nsid through regionToken → list → switch ∥ info with the kubeconfig namespace rewritten", async () => {
    const { calls, handler, logs } = handlerWith();
    const response = await handler(sessionRequest({ body: { nsid: TEAM.id } }));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const session = brainSessionSchema.parse(await response.json());
    expect(session.regionalToken).toBe(TEAM_REGIONAL_TOKEN);
    expect(session.appToken).toBe(TEAM_APP_TOKEN);
    expect(session.namespace).toBe(TEAM.id);
    expect(namespaceFromKubeconfigText(session.kubeconfig)).toBe(TEAM.id);
    expect(session.kubeconfig).toContain("sa-token-abc12345");
    expect(session.fallback).toBeUndefined();
    expect(session.workspace).toEqual({
      createdAt: TEAM.createTime,
      id: TEAM.id,
      isPersonal: false,
      name: "Acme",
      role: "Manager",
      uid: TEAM.uid,
    });
    expect(session.workspaces.map((workspace) => workspace.id)).toEqual([
      PERSONAL.id,
      TEAM.id,
    ]);
    expect(session.workspaces[0]?.isPersonal).toBe(true);
    expect(session.workspaces[0]?.role).toBe("Owner");
    // user identity decoded from the regional token, display data from info
    expect(session.user).toEqual({
      avatar: "https://desktop.test/avatar.png",
      crName: "abc12345",
      name: "Ada",
      userId: "user-id-1",
      userUid: "user-uid-1",
    });

    expect(calls.map((call) => call.path)).toEqual([
      "/api/auth/regionToken",
      "/api/auth/namespace/list",
      "/api/auth/namespace/switch",
      "/api/auth/info",
    ]);
    // global token: URL-encoded, no Bearer; regional token: URL-encoded
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.authorization).toBe(encodeURIComponent(GLOBAL_TOKEN));
    expect(calls[0]?.authorization?.startsWith("Bearer")).toBe(false);
    expect(calls[1]?.method).toBe("GET");
    expect(calls[1]?.authorization).toBe(
      encodeURIComponent(PERSONAL_REGIONAL_TOKEN)
    );
    expect(calls[2]?.body).toEqual({ ns_uid: TEAM.uid });
    expect(calls[3]?.authorization).toBe(
      encodeURIComponent(PERSONAL_REGIONAL_TOKEN)
    );
    expect(logs).toEqual([]);
  });

  it("does not call switch for the Personal nsid or when nsid is omitted", async () => {
    for (const body of [{ nsid: PERSONAL.id }, {}]) {
      const { calls, handler } = handlerWith();
      const response = await handler(sessionRequest({ body }));
      expect(response.status).toBe(200);
      const session = brainSessionSchema.parse(await response.json());
      expect(session.workspace.id).toBe(PERSONAL.id);
      expect(session.regionalToken).toBe(PERSONAL_REGIONAL_TOKEN);
      expect(session.appToken).toBe(PERSONAL_APP_TOKEN);
      expect(namespaceFromKubeconfigText(session.kubeconfig)).toBe(PERSONAL.id);
      expect(session.fallback).toBeUndefined();
      expect(calls.map((call) => call.path)).toEqual([
        "/api/auth/regionToken",
        "/api/auth/namespace/list",
        "/api/auth/info",
      ]);
    }
  });

  it("lands in Personal with fallback not_member when nsid is not in the list", async () => {
    const { calls, handler, logs } = handlerWith();
    const response = await handler(
      sessionRequest({ body: { nsid: "ns-gone" } })
    );
    expect(response.status).toBe(200);
    const session = brainSessionSchema.parse(await response.json());
    expect(session.fallback).toBe("not_member");
    expect(session.workspace.id).toBe(PERSONAL.id);
    expect(calls.some((call) => call.path.endsWith("/switch"))).toBe(false);
    expectNoTokenInLogs(logs);
  });

  it("answers 401 without a login cookie, and 401 when Desktop rejects the global token", async () => {
    const missing = handlerWith();
    const withoutCookie = await missing.handler(
      sessionRequest({ cookie: null })
    );
    expect(withoutCookie.status).toBe(401);
    expect(await withoutCookie.json()).toEqual({ error: "session_expired" });
    expect(missing.calls).toEqual([]);

    const rejected = handlerWith({
      ...defaultDesktopAnswers(),
      "/api/auth/regionToken": { code: 401, message: "invalid token" },
    });
    const response = await rejected.handler(sessionRequest({}));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "session_expired" });
    expect(rejected.calls.map((call) => call.path)).toEqual([
      "/api/auth/regionToken",
    ]);
    expectNoTokenInLogs(rejected.logs);
  });

  it("uses DEV_GLOBAL_TOKEN without a cookie in development, never in production", async () => {
    const dev = handlerWith(defaultDesktopAnswers(), {
      ...DEV_ENV,
      DEV_GLOBAL_TOKEN: "dev.global.token",
    });
    const devResponse = await dev.handler(sessionRequest({ cookie: null }));
    expect(devResponse.status).toBe(200);
    expect(dev.calls[0]?.authorization).toBe(
      encodeURIComponent("dev.global.token")
    );

    const cookieWins = handlerWith(defaultDesktopAnswers(), {
      ...DEV_ENV,
      DEV_GLOBAL_TOKEN: "dev.global.token",
    });
    await cookieWins.handler(sessionRequest({}));
    expect(cookieWins.calls[0]?.authorization).toBe(
      encodeURIComponent(GLOBAL_TOKEN)
    );

    const production = handlerWith(defaultDesktopAnswers(), {
      ...DEV_ENV,
      DEV_GLOBAL_TOKEN: "dev.global.token",
      NODE_ENV: "production",
    });
    const productionResponse = await production.handler(
      sessionRequest({ cookie: null })
    );
    expect(productionResponse.status).toBe(401);
    expect(production.calls).toEqual([]);
    expect(JSON.stringify(production.logs).includes("dev.global.token")).toBe(
      false
    );
  });

  it("answers 409 for 'workspace is not inited' and never calls autoInitRegionToken", async () => {
    const { calls, handler, logs } = handlerWith({
      ...defaultDesktopAnswers(),
      "/api/auth/regionToken": {
        code: 409,
        message: "workspace is not inited",
      },
    });
    const response = await handler(sessionRequest({}));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "workspace_not_inited" });
    expect(calls.map((call) => call.path)).toEqual(["/api/auth/regionToken"]);
    expect(logs.length).toBe(1);
    expect(logs[0]?.fields).toMatchObject({ kind: "not_inited" });
    expectNoTokenInLogs(logs);
  });

  it("answers 502 when Desktop is unreachable, misconfigured, or malformed, and 504 on timeout", async () => {
    const unreachable = handlerWith({
      ...defaultDesktopAnswers(),
      "/api/auth/regionToken": new Error("ECONNREFUSED"),
    });
    expect((await unreachable.handler(sessionRequest({}))).status).toBe(502);
    expect(unreachable.logs[0]?.fields).toMatchObject({
      kind: "unreachable",
      step: "regionToken",
    });

    const malformed = handlerWith({
      ...defaultDesktopAnswers(),
      "/api/auth/namespace/list": { code: 200, data: { namespaces: "nope" } },
    });
    const malformedResponse = await malformed.handler(sessionRequest({}));
    expect(malformedResponse.status).toBe(502);
    expect(await malformedResponse.json()).toEqual({
      error: "desktop_unavailable",
    });
    expect(malformed.logs[0]?.fields).toMatchObject({
      kind: "malformed",
      step: "list",
    });

    const otherCode = handlerWith({
      ...defaultDesktopAnswers(),
      "/api/auth/namespace/switch": {
        code: 403,
        message: "You are not in this workspace",
      },
    });
    const otherResponse = await otherCode.handler(
      sessionRequest({ body: { nsid: TEAM.id } })
    );
    expect(otherResponse.status).toBe(502);
    expect(otherCode.logs[0]?.fields).toMatchObject({
      code: 403,
      kind: "desktop_error",
      step: "switch",
    });

    const timeoutError = new Error("timeout");
    timeoutError.name = "TimeoutError";
    const timedOut = handlerWith({
      ...defaultDesktopAnswers(),
      "/api/auth/info": timeoutError,
    });
    const timeoutResponse = await timedOut.handler(sessionRequest({}));
    expect(timeoutResponse.status).toBe(504);
    expect(await timeoutResponse.json()).toEqual({ error: "desktop_timeout" });

    const unconfigured = handlerWith(defaultDesktopAnswers(), {
      NODE_ENV: "development",
    });
    expect((await unconfigured.handler(sessionRequest({}))).status).toBe(502);
    expect(unconfigured.calls).toEqual([]);

    expectNoTokenInLogs([
      ...unreachable.logs,
      ...malformed.logs,
      ...otherCode.logs,
      ...timedOut.logs,
      ...unconfigured.logs,
    ]);
  });

  it("rejects a body that is not the session request shape, and one that is not JSON", async () => {
    const { calls, handler } = handlerWith();
    const response = await handler(sessionRequest({ body: { nsid: 42 } }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_session_request" });

    const notJson = await handler(
      new Request("https://brain.test/api/session", {
        body: "nsid=ns-team",
        headers: { cookie: `sealos_auth_token=${GLOBAL_TOKEN}` },
        method: "POST",
      })
    );
    expect(notJson.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it("treats a 401 on a token Desktop just minted as a Desktop anomaly, not a logout", async () => {
    const { handler, logs } = handlerWith({
      ...defaultDesktopAnswers(),
      "/api/auth/namespace/switch": {
        code: 401,
        message: "token verify error",
      },
    });
    const response = await handler(sessionRequest({ body: { nsid: TEAM.id } }));
    expect(response.status).toBe(502);
    expect(logs[0]?.fields).toMatchObject({
      code: 401,
      kind: "desktop_error",
      step: "switch",
    });
    expectNoTokenInLogs(logs);
  });

  it("accepts an empty body", async () => {
    const { handler } = handlerWith();
    const response = await handler(
      new Request("https://brain.test/api/session", {
        headers: { cookie: `sealos_auth_token=${GLOBAL_TOKEN}` },
        method: "POST",
      })
    );
    expect(response.status).toBe(200);
  });
});
