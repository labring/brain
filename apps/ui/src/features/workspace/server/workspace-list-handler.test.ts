import { describe, expect, it, mock } from "bun:test";

import { REGION_TOKEN_HEADER } from "@/lib/region-token-header";

import { WORKSPACE_ERROR_CODES } from "../workspace-errors";
import { workspaceListResponseSchema } from "../workspace-list-schema";

mock.module("server-only", () => ({}));
const { createWorkspaceListHandler } = await import("./workspace-list-handler");
const { createFakeDesktop, defaultDesktopAnswers, PERSONAL, TEAM } =
  await import("@/features/session/server/desktop-test-double");

const DEV_ENV = {
  DESKTOP_API_BASE_URL: "http://sealos-desktop.sealos.svc:3000",
  NODE_ENV: "development",
};
const REGIONAL_TOKEN = "regional.token/with+chars";

function listRequest(input: { token?: string | null } = {}): Request {
  const headers: Record<string, string> = {};
  if (input.token !== null) {
    headers[REGION_TOKEN_HEADER] = input.token ?? REGIONAL_TOKEN;
  }
  return new Request("https://brain.test/api/workspace/list", {
    headers,
    method: "GET",
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
  const handler = createWorkspaceListHandler({
    env,
    fetchDesktop: desktop.fetch,
    log: (message, fields) => logs.push({ fields, message }),
  });
  return { calls: desktop.calls, handler, logs };
}

describe("GET /api/workspace/list", () => {
  it("answers the user's Workspaces in Brain's shape, Desktop's order, with the regional token URL-encoded", async () => {
    const { calls, handler } = handlerWith();
    const response = await handler(listRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const workspaces = workspaceListResponseSchema.parse(await response.json());
    expect(workspaces.map((workspace) => workspace.id)).toEqual([
      PERSONAL.id,
      TEAM.id,
    ]);
    expect(workspaces[0]).toEqual({
      createdAt: PERSONAL.createTime,
      id: PERSONAL.id,
      isPersonal: true,
      name: PERSONAL.teamName,
      role: "Owner",
      uid: PERSONAL.uid,
    });
    expect(workspaces[1]?.role).toBe("Manager");
    expect(calls).toEqual([
      {
        authorization: encodeURIComponent(REGIONAL_TOKEN),
        body: undefined,
        method: "GET",
        path: "/api/auth/namespace/list",
      },
    ]);
  });

  it("answers 401 without the region token header and never calls Desktop", async () => {
    const { calls, handler } = handlerWith();
    const response = await handler(listRequest({ token: null }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: WORKSPACE_ERROR_CODES.regionTokenRequired,
    });
    expect(calls).toEqual([]);
  });

  it("translates Desktop's business codes into real HTTP statuses", async () => {
    for (const [code, status, error] of [
      [401, 401, WORKSPACE_ERROR_CODES.sessionExpired],
      [403, 403, WORKSPACE_ERROR_CODES.forbidden],
      [404, 404, WORKSPACE_ERROR_CODES.notFound],
      [409, 409, WORKSPACE_ERROR_CODES.conflict],
      [500, 500, WORKSPACE_ERROR_CODES.desktopError],
    ] as const) {
      const { handler } = handlerWith({
        "/api/auth/namespace/list": { code, message: "desktop text" },
      });
      const response = await handler(listRequest());
      expect(response.status).toBe(status);
      // Brain's structured code, never Desktop's hard-coded message.
      expect(await response.json()).toEqual({ error });
    }
  });

  it("answers 502 for an unreachable or malformed Desktop and 504 for a timeout", async () => {
    const unreachable = handlerWith({
      "/api/auth/namespace/list": new TypeError("fetch failed"),
    });
    expect((await unreachable.handler(listRequest())).status).toBe(502);

    const malformed = handlerWith({
      "/api/auth/namespace/list": new Response("<html>", { status: 200 }),
    });
    expect((await malformed.handler(listRequest())).status).toBe(502);

    const timeout = handlerWith({
      "/api/auth/namespace/list": Object.assign(new Error("aborted"), {
        name: "TimeoutError",
      }),
    });
    const response = await timeout.handler(listRequest());
    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({
      error: WORKSPACE_ERROR_CODES.desktopTimeout,
    });
  });

  it("answers 502 when DESKTOP_API_BASE_URL is unset", async () => {
    const { calls, handler } = handlerWith(defaultDesktopAnswers(), {
      NODE_ENV: "development",
    });
    expect((await handler(listRequest())).status).toBe(502);
    expect(calls).toEqual([]);
  });

  it("logs failures structurally without the regional token", async () => {
    const { handler, logs } = handlerWith({
      "/api/auth/namespace/list": { code: 403 },
    });
    await handler(listRequest());
    expect(logs.length).toBeGreaterThan(0);
    expect(JSON.stringify(logs).includes(REGIONAL_TOKEN)).toBe(false);
    expect(
      JSON.stringify(logs).includes(encodeURIComponent(REGIONAL_TOKEN))
    ).toBe(false);
  });
});
