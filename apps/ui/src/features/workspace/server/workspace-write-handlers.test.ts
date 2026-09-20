import { describe, expect, it, mock } from "bun:test";

import type { FakeDesktopOptions } from "@/features/session/server/desktop-test-double";
import { REGION_TOKEN_HEADER } from "@/lib/region-token-header";
import { WORKSPACE_ERROR_CODES } from "../workspace-errors";
import {
  WORKSPACE_ALIAS_MAX_LENGTH,
  WORKSPACE_NAME_MAX_LENGTH,
} from "../workspace-write-schema";
import type { WorkspaceRouteDependencies } from "./workspace-route-context";
import type { WorkspaceRouteEntry } from "./workspace-route-table";

mock.module("server-only", () => ({}));
const {
  createWorkspaceDeleteHandler,
  createWorkspaceInviteLinkHandler,
  createWorkspaceMemberAliasHandler,
  createWorkspaceMemberRemoveHandler,
  createWorkspaceMemberRoleHandler,
  createWorkspaceRenameHandler,
  createWorkspaceTransferHandler,
} = await import("./workspace-write-handlers");
const { WORKSPACE_ROUTES } = await import("./workspace-route-table");
const { createFakeDesktop, PERSONAL, TEAM } = await import(
  "@/features/session/server/desktop-test-double"
);

const DEV_ENV = {
  DESKTOP_API_BASE_URL: "http://sealos-desktop.sealos.svc:3000",
  NODE_ENV: "development",
};
const REGIONAL_TOKEN = "regional.token/with+chars";
const TARGET_CR_UID = "cr-uid-target";

interface LogEntry {
  fields: Record<string, unknown>;
  message: string;
}

type Handler = (request: Request) => Promise<Response>;
type HandlerFactory = (dependencies: WorkspaceRouteDependencies) => Handler;

/**
 * One row per write route (spec §B.2): the handler, its public path, the
 * Desktop path it calls, a valid body, the Desktop body that must result,
 * and the bodies the route must refuse before calling Desktop.
 */
const ROUTES: {
  create: HandlerFactory;
  desktopBody: unknown;
  entry: WorkspaceRouteEntry;
  invalidBodies: unknown[];
  name: string;
  validBody: unknown;
}[] = [
  {
    create: createWorkspaceRenameHandler,
    desktopBody: { ns_uid: TEAM.uid, teamName: "Acme Robotics" },
    entry: WORKSPACE_ROUTES.rename,
    invalidBodies: [
      {},
      { uid: TEAM.uid },
      { name: "Acme", uid: "  " },
      { name: "   ", uid: TEAM.uid },
      { name: "x".repeat(WORKSPACE_NAME_MAX_LENGTH + 1), uid: TEAM.uid },
      { name: 42, uid: TEAM.uid },
    ],
    name: "rename",
    validBody: { name: "  Acme Robotics  ", uid: TEAM.uid },
  },
  {
    create: createWorkspaceDeleteHandler,
    desktopBody: { ns_uid: TEAM.uid },
    entry: WORKSPACE_ROUTES.delete,
    invalidBodies: [{}, { uid: "" }, { uid: 1 }],
    name: "delete",
    validBody: { uid: TEAM.uid },
  },
  {
    create: createWorkspaceInviteLinkHandler,
    // Desktop's `UserRole`: Owner 0, Manager 1, Developer 2.
    desktopBody: { ns_uid: TEAM.uid, role: 2 },
    entry: WORKSPACE_ROUTES.inviteLink,
    invalidBodies: [
      {},
      { uid: TEAM.uid },
      { role: "Owner", uid: TEAM.uid },
      { role: 2, uid: TEAM.uid },
      { role: "developer", uid: TEAM.uid },
    ],
    name: "invite-link",
    validBody: { role: "Developer", uid: TEAM.uid },
  },
  {
    create: createWorkspaceMemberRemoveHandler,
    desktopBody: { ns_uid: TEAM.uid, targetUserCrUid: TARGET_CR_UID },
    entry: WORKSPACE_ROUTES.memberRemove,
    invalidBodies: [{}, { uid: TEAM.uid }, { crUid: " ", uid: TEAM.uid }],
    name: "member/remove",
    validBody: { crUid: TARGET_CR_UID, uid: TEAM.uid },
  },
  {
    create: createWorkspaceMemberRoleHandler,
    desktopBody: { ns_uid: TEAM.uid, tRole: 1, targetUserCrUid: TARGET_CR_UID },
    entry: WORKSPACE_ROUTES.memberRole,
    invalidBodies: [
      {},
      { crUid: TARGET_CR_UID, uid: TEAM.uid },
      { crUid: TARGET_CR_UID, role: "Owner", uid: TEAM.uid },
      { crUid: TARGET_CR_UID, role: 0, uid: TEAM.uid },
    ],
    name: "member/role",
    validBody: { crUid: TARGET_CR_UID, role: "Manager", uid: TEAM.uid },
  },
  {
    create: createWorkspaceMemberAliasHandler,
    desktopBody: {
      alias: "Frontend lead",
      ns_uid: TEAM.uid,
      targetUserCrUid: TARGET_CR_UID,
    },
    entry: WORKSPACE_ROUTES.memberAlias,
    invalidBodies: [
      {},
      { alias: "x", uid: TEAM.uid },
      { alias: 7, crUid: TARGET_CR_UID, uid: TEAM.uid },
      {
        alias: "x".repeat(WORKSPACE_ALIAS_MAX_LENGTH + 1),
        crUid: TARGET_CR_UID,
        uid: TEAM.uid,
      },
    ],
    name: "member/alias",
    validBody: {
      alias: "  Frontend lead ",
      crUid: TARGET_CR_UID,
      uid: TEAM.uid,
    },
  },
  {
    create: createWorkspaceTransferHandler,
    desktopBody: { ns_uid: TEAM.uid, targetUserCrUid: TARGET_CR_UID },
    entry: WORKSPACE_ROUTES.transfer,
    invalidBodies: [{}, { uid: TEAM.uid }, { crUid: "", uid: TEAM.uid }],
    name: "transfer",
    validBody: { crUid: TARGET_CR_UID, uid: TEAM.uid },
  },
];

function successAnswer(desktopPath: string): FakeDesktopOptions["answers"] {
  return {
    [desktopPath]:
      desktopPath === WORKSPACE_ROUTES.inviteLink.desktopPath
        ? { code: 200, data: { code: "0f2c1a9e-invite-code" } }
        : { code: 200, data: null },
  };
}

function writeRequest(
  apiPath: string,
  input: { body?: unknown; rawBody?: string; token?: string | null } = {}
): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (input.token !== null) {
    headers[REGION_TOKEN_HEADER] = input.token ?? REGIONAL_TOKEN;
  }
  return new Request(`https://brain.test${apiPath}`, {
    body: input.rawBody ?? JSON.stringify(input.body ?? {}),
    headers,
    method: "POST",
  });
}

function handlerWith(
  create: HandlerFactory,
  answers: FakeDesktopOptions["answers"]
) {
  const desktop = createFakeDesktop({ answers });
  const logs: LogEntry[] = [];
  const handler = create({
    env: DEV_ENV,
    fetchDesktop: desktop.fetch,
    log: (message, fields) => logs.push({ fields, message }),
  });
  return { calls: desktop.calls, handler, logs };
}

for (const route of ROUTES) {
  describe(`POST ${route.entry.apiPath}`, () => {
    it("calls Desktop with the translated body and answers Brain's shape", async () => {
      const { calls, handler } = handlerWith(
        route.create,
        successAnswer(route.entry.desktopPath)
      );
      const response = await handler(
        writeRequest(route.entry.apiPath, { body: route.validBody })
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual(
        route.entry === WORKSPACE_ROUTES.inviteLink
          ? { code: "0f2c1a9e-invite-code" }
          : { ok: true }
      );
      expect(calls).toEqual([
        {
          authorization: encodeURIComponent(REGIONAL_TOKEN),
          body: route.desktopBody,
          method: "POST",
          path: route.entry.desktopPath,
        },
      ]);
    });

    it("answers 400 for an invalid or non-JSON body, never calling Desktop", async () => {
      const { calls, handler } = handlerWith(
        route.create,
        successAnswer(route.entry.desktopPath)
      );
      for (const body of route.invalidBodies) {
        const response = await handler(
          writeRequest(route.entry.apiPath, { body })
        );
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: WORKSPACE_ERROR_CODES.invalidRequest,
        });
      }
      const nonJson = await handler(
        writeRequest(route.entry.apiPath, { rawBody: "not json" })
      );
      expect(nonJson.status).toBe(400);
      expect(calls).toEqual([]);
    });

    it("answers 401 without the region token header, never calling Desktop", async () => {
      const { calls, handler } = handlerWith(
        route.create,
        successAnswer(route.entry.desktopPath)
      );
      const response = await handler(
        writeRequest(route.entry.apiPath, {
          body: route.validBody,
          token: null,
        })
      );
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        error: WORKSPACE_ERROR_CODES.regionTokenRequired,
      });
      expect(calls).toEqual([]);
    });

    it("translates Desktop's 403 / 404 / 409 into Brain's codes without its message text", async () => {
      for (const [code, status, error] of [
        [403, 403, WORKSPACE_ERROR_CODES.forbidden],
        [404, 404, WORKSPACE_ERROR_CODES.notFound],
        [409, 409, WORKSPACE_ERROR_CODES.conflict],
        [500, 500, WORKSPACE_ERROR_CODES.desktopError],
      ] as const) {
        const { handler, logs } = handlerWith(route.create, {
          [route.entry.desktopPath]: {
            code,
            message: "you are not manager",
          },
        });
        const response = await handler(
          writeRequest(route.entry.apiPath, { body: route.validBody })
        );
        expect(response.status).toBe(status);
        expect(await response.json()).toEqual({ error });
        const serialized = JSON.stringify(logs);
        expect(logs.length).toBeGreaterThan(0);
        expect(serialized.includes(REGIONAL_TOKEN)).toBe(false);
        expect(serialized.includes(encodeURIComponent(REGIONAL_TOKEN))).toBe(
          false
        );
      }
    });

    it("answers 504 for a Desktop timeout and 502 for a malformed answer", async () => {
      const timeout = handlerWith(route.create, {
        [route.entry.desktopPath]: Object.assign(new Error("aborted"), {
          name: "TimeoutError",
        }),
      });
      const timedOut = await timeout.handler(
        writeRequest(route.entry.apiPath, { body: route.validBody })
      );
      expect(timedOut.status).toBe(504);

      const malformed = handlerWith(route.create, {
        [route.entry.desktopPath]: new Response("<html>", { status: 200 }),
      });
      const broken = await malformed.handler(
        writeRequest(route.entry.apiPath, { body: route.validBody })
      );
      expect(broken.status).toBe(502);
    });
  });
}

describe("POST /api/workspace/member/alias", () => {
  it("sends Desktop null for a blank alias so it clears", async () => {
    for (const alias of ["", "   ", null]) {
      const { calls, handler } = handlerWith(
        createWorkspaceMemberAliasHandler,
        successAnswer(WORKSPACE_ROUTES.memberAlias.desktopPath)
      );
      const response = await handler(
        writeRequest(WORKSPACE_ROUTES.memberAlias.apiPath, {
          body: { alias, crUid: TARGET_CR_UID, uid: TEAM.uid },
        })
      );
      expect(response.status).toBe(200);
      expect(calls[0]?.body).toEqual({
        alias: null,
        ns_uid: TEAM.uid,
        targetUserCrUid: TARGET_CR_UID,
      });
    }
  });
});

describe("POST /api/workspace/invite-link", () => {
  const managerLinkAnswers: FakeDesktopOptions["answers"] = {
    [WORKSPACE_ROUTES.list.desktopPath]: {
      code: 200,
      data: { namespaces: [PERSONAL, TEAM] },
    },
    [WORKSPACE_ROUTES.inviteLink.desktopPath]: {
      code: 200,
      data: { code: "0f2c1a9e-invite-code" },
    },
  };

  it("proves the actor is the Owner before sending Desktop the Manager code", async () => {
    const ownedTeam = {
      ...TEAM,
      id: "ns-owned01",
      role: 0,
      uid: "33333333-3333-4333-8333-333333333333",
    };
    const { calls, handler } = handlerWith(createWorkspaceInviteLinkHandler, {
      ...managerLinkAnswers,
      [WORKSPACE_ROUTES.list.desktopPath]: {
        code: 200,
        data: { namespaces: [PERSONAL, ownedTeam] },
      },
    });
    const response = await handler(
      writeRequest(WORKSPACE_ROUTES.inviteLink.apiPath, {
        body: { role: "Manager", uid: ownedTeam.uid },
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ code: "0f2c1a9e-invite-code" });
    expect(calls[0]?.path).toBe(WORKSPACE_ROUTES.list.desktopPath);
    expect(calls[1]?.body).toEqual({ ns_uid: ownedTeam.uid, role: 1 });
  });

  it("refuses a Manager link from a non-Owner actor — the hole Desktop leaves open", async () => {
    const { calls, handler } = handlerWith(
      createWorkspaceInviteLinkHandler,
      managerLinkAnswers
    );
    const response = await handler(
      writeRequest(WORKSPACE_ROUTES.inviteLink.apiPath, {
        // The double's TEAM carries this actor as a Manager.
        body: { role: "Manager", uid: TEAM.uid },
      })
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: WORKSPACE_ERROR_CODES.forbidden,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe(WORKSPACE_ROUTES.list.desktopPath);
  });

  it("mints a Developer link without the Owner proof call", async () => {
    const { calls, handler } = handlerWith(createWorkspaceInviteLinkHandler, {
      [WORKSPACE_ROUTES.inviteLink.desktopPath]: {
        code: 200,
        data: { code: "0f2c1a9e-invite-code" },
      },
    });
    const response = await handler(
      writeRequest(WORKSPACE_ROUTES.inviteLink.apiPath, {
        body: { role: "Developer", uid: TEAM.uid },
      })
    );

    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual({ ns_uid: TEAM.uid, role: 2 });
  });

  it("answers 502 when Desktop's data carries no code", async () => {
    const { handler } = handlerWith(createWorkspaceInviteLinkHandler, {
      [WORKSPACE_ROUTES.inviteLink.desktopPath]: { code: 200, data: {} },
    });
    const response = await handler(
      writeRequest(WORKSPACE_ROUTES.inviteLink.apiPath, {
        body: { role: "Developer", uid: TEAM.uid },
      })
    );
    expect(response.status).toBe(502);
  });
});
