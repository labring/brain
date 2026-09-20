import { describe, expect, it, mock } from "bun:test";

import type { FakeDesktopOptions } from "@/features/session/server/desktop-test-double";
import { REGION_TOKEN_HEADER } from "@/lib/region-token-header";

import { workspaceDetailsResponseSchema } from "../workspace-details-schema";
import { WORKSPACE_ERROR_CODES } from "../workspace-errors";

mock.module("server-only", () => ({}));
const { createWorkspaceDetailsHandler } = await import(
  "./workspace-details-handler"
);
const { createFakeDesktop, defaultDesktopAnswers, TEAM } = await import(
  "@/features/session/server/desktop-test-double"
);

const DEV_ENV = {
  DESKTOP_API_BASE_URL: "http://sealos-desktop.sealos.svc:3000",
  NODE_ENV: "development",
};
const REGIONAL_TOKEN = "regional.token/with+chars";

/** Desktop's `TeamUserDto` rows for the Team Workspace, as `details` answers. */
const OWNER_USER = {
  alias: "Team lead",
  avatarUrl: "https://desktop.test/kai.png",
  crUid: "cr-uid-kai",
  createdTime: "2026-02-01T00:00:00.000Z",
  joinTime: "2026-02-01T00:00:00.000Z",
  k8s_username: "kai00001",
  nickname: "Kai",
  role: 0,
  status: 1,
  uid: "user-uid-kai",
};
const ME_USER = {
  avatarUrl: "",
  crUid: "cr-uid-1",
  createdTime: "2026-01-01T00:00:00.000Z",
  joinTime: "2026-02-14T09:00:00.000Z",
  k8s_username: "abc12345",
  nickname: "Ada",
  role: 1,
  status: 1,
  uid: "user-uid-1",
};
/** A row without `joinTime` (Desktop's DTO leaves it optional), created at an epoch. */
const DEV_USER = {
  avatarUrl: "",
  crUid: "cr-uid-dev",
  createdTime: Date.UTC(2026, 2, 1),
  k8s_username: "dev00001",
  nickname: "Dev",
  role: 2,
  status: 1,
  uid: "user-uid-dev",
};

function detailsAnswers(): FakeDesktopOptions["answers"] {
  return {
    ...defaultDesktopAnswers(),
    "/api/auth/namespace/details": {
      code: 200,
      data: { namespace: TEAM, users: [OWNER_USER, ME_USER, DEV_USER] },
    },
  };
}

function detailsRequest(
  input: { body?: unknown; rawBody?: string; token?: string | null } = {}
): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (input.token !== null) {
    headers[REGION_TOKEN_HEADER] = input.token ?? REGIONAL_TOKEN;
  }
  return new Request("https://brain.test/api/workspace/details", {
    body: input.rawBody ?? JSON.stringify(input.body ?? { uid: TEAM.uid }),
    headers,
    method: "POST",
  });
}

interface LogEntry {
  fields: Record<string, unknown>;
  message: string;
}

function handlerWith(
  answers = detailsAnswers(),
  env: Record<string, string | undefined> = DEV_ENV
) {
  const desktop = createFakeDesktop({ answers });
  const logs: LogEntry[] = [];
  const handler = createWorkspaceDetailsHandler({
    env,
    fetchDesktop: desktop.fetch,
    log: (message, fields) => logs.push({ fields, message }),
  });
  return { calls: desktop.calls, handler, logs };
}

describe("POST /api/workspace/details", () => {
  it("answers the Workspace and its members in Brain's shape, calling Desktop with the uid as ns_uid", async () => {
    const { calls, handler } = handlerWith();
    const response = await handler(detailsRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const details = workspaceDetailsResponseSchema.parse(await response.json());
    expect(details.workspace).toEqual({
      createdAt: TEAM.createTime,
      id: TEAM.id,
      isPersonal: false,
      name: TEAM.teamName,
      role: "Manager",
      uid: TEAM.uid,
    });
    expect(details.members).toEqual([
      {
        alias: "Team lead",
        avatarUrl: "https://desktop.test/kai.png",
        crName: "kai00001",
        crUid: "cr-uid-kai",
        joinedAt: "2026-02-01T00:00:00.000Z",
        nickname: "Kai",
        role: "Owner",
        userUid: "user-uid-kai",
      },
      {
        alias: null,
        avatarUrl: "",
        crName: "abc12345",
        crUid: "cr-uid-1",
        joinedAt: "2026-02-14T09:00:00.000Z",
        nickname: "Ada",
        role: "Manager",
        userUid: "user-uid-1",
      },
      {
        alias: null,
        avatarUrl: "",
        crName: "dev00001",
        crUid: "cr-uid-dev",
        // No joinTime: the CR's creation time stands in, an epoch made ISO.
        joinedAt: "2026-03-01T00:00:00.000Z",
        nickname: "Dev",
        role: "Developer",
        userUid: "user-uid-dev",
      },
    ]);
    expect(calls).toEqual([
      {
        authorization: encodeURIComponent(REGIONAL_TOKEN),
        body: { ns_uid: TEAM.uid },
        method: "POST",
        path: "/api/auth/namespace/details",
      },
    ]);
  });

  it("answers 400 for a missing or blank uid and for a non-JSON body, never calling Desktop", async () => {
    const { calls, handler } = handlerWith();
    for (const request of [
      detailsRequest({ body: {} }),
      detailsRequest({ body: { uid: "   " } }),
      detailsRequest({ body: { uid: 42 } }),
      detailsRequest({ rawBody: "not json" }),
    ]) {
      const response = await handler(request);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: WORKSPACE_ERROR_CODES.invalidRequest,
      });
    }
    expect(calls).toEqual([]);
  });

  it("answers 401 without the region token header and never calls Desktop", async () => {
    const { calls, handler } = handlerWith();
    const response = await handler(detailsRequest({ token: null }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: WORKSPACE_ERROR_CODES.regionTokenRequired,
    });
    expect(calls).toEqual([]);
  });

  it("translates Desktop's business codes into real HTTP statuses without its message text", async () => {
    for (const [code, status, error] of [
      [400, 400, WORKSPACE_ERROR_CODES.invalidRequest],
      [401, 401, WORKSPACE_ERROR_CODES.sessionExpired],
      [403, 403, WORKSPACE_ERROR_CODES.forbidden],
      [404, 404, WORKSPACE_ERROR_CODES.notFound],
      [500, 500, WORKSPACE_ERROR_CODES.desktopError],
    ] as const) {
      const { handler } = handlerWith({
        "/api/auth/namespace/details": {
          code,
          message: "You are not in the namespace",
        },
      });
      const response = await handler(detailsRequest());
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error });
    }
  });

  it("answers 502 for a malformed Desktop answer and 504 for a timeout", async () => {
    const malformed = handlerWith({
      "/api/auth/namespace/details": {
        code: 200,
        data: { namespace: TEAM, users: [{ nickname: "no ids" }] },
      },
    });
    expect((await malformed.handler(detailsRequest())).status).toBe(502);

    const timeout = handlerWith({
      "/api/auth/namespace/details": Object.assign(new Error("aborted"), {
        name: "TimeoutError",
      }),
    });
    const response = await timeout.handler(detailsRequest());
    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({
      error: WORKSPACE_ERROR_CODES.desktopTimeout,
    });
  });

  it("logs failures structurally without the regional token", async () => {
    const { handler, logs } = handlerWith({
      "/api/auth/namespace/details": { code: 404 },
    });
    await handler(detailsRequest());
    expect(logs.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(logs);
    expect(serialized.includes(REGIONAL_TOKEN)).toBe(false);
    expect(serialized.includes(encodeURIComponent(REGIONAL_TOKEN))).toBe(false);
  });
});
