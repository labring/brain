import type { DesktopFetch } from "./desktop-client";

/**
 * A fake Desktop for the server tests (spec "Testing Decisions", seam 1):
 * answers each `/api/auth/*` path with Desktop's "HTTP 200 + body.code"
 * envelope and records every call so tests can assert order, headers, and
 * bodies. Tokens are opaque strings except the regional ones, which carry a
 * decodable payload the way Desktop's do.
 */

export interface RecordedDesktopCall {
  authorization: string | null;
  body: unknown;
  method: string;
  path: string;
}

export type DesktopAnswer =
  | { code: number; data?: unknown; message?: string }
  | Response
  | Error;

export interface FakeDesktopOptions {
  answers: Partial<
    Record<
      string,
      DesktopAnswer | ((call: RecordedDesktopCall) => DesktopAnswer)
    >
  >;
}

export function fakeRegionalToken(claims: {
  userCrName?: string;
  userId?: string;
  userUid?: string;
  workspaceId: string;
  workspaceUid: string;
}): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" })
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iat: 1_700_000_000,
      regionUid: "region-1",
      userCrName: claims.userCrName ?? "abc12345",
      userCrUid: "cr-uid-1",
      userId: claims.userId ?? "user-id-1",
      userUid: claims.userUid ?? "user-uid-1",
      workspaceId: claims.workspaceId,
      workspaceUid: claims.workspaceUid,
    })
  ).toString("base64url");
  return `${header}.${payload}.sig-${claims.workspaceId}`;
}

export const FAKE_KUBECONFIG = `apiVersion: v1
kind: Config
current-context: abc12345
contexts:
  - name: abc12345
    context:
      cluster: sealos
      user: abc12345
      namespace: ns-abc12345
clusters:
  - name: sealos
    cluster:
      server: https://apiserver.test
users:
  - name: abc12345
    user:
      token: sa-token-abc12345
`;

export const PERSONAL = {
  createTime: "2026-01-01T00:00:00.000Z",
  id: "ns-abc12345",
  nstype: 1,
  role: 0,
  teamName: "private team",
  uid: "11111111-1111-4111-8111-111111111111",
};

export const TEAM = {
  createTime: "2026-02-01T00:00:00.000Z",
  id: "ns-team0001",
  nstype: 0,
  role: 1,
  teamName: "Acme",
  uid: "22222222-2222-4222-8222-222222222222",
};

export const GLOBAL_TOKEN = "global.token.value";
export const PERSONAL_REGIONAL_TOKEN = fakeRegionalToken({
  workspaceId: PERSONAL.id,
  workspaceUid: PERSONAL.uid,
});
export const TEAM_REGIONAL_TOKEN = fakeRegionalToken({
  workspaceId: TEAM.id,
  workspaceUid: TEAM.uid,
});
export const PERSONAL_APP_TOKEN = "app.token.personal";
export const TEAM_APP_TOKEN = "app.token.team";

/** The happy-path answers; override per test. */
export function defaultDesktopAnswers(): FakeDesktopOptions["answers"] {
  return {
    "/api/auth/info": {
      code: 200,
      data: {
        info: {
          avatarUri: "https://desktop.test/avatar.png",
          id: "user-id-1",
          name: "ada",
          nickname: "Ada",
          uid: "user-uid-1",
        },
      },
    },
    "/api/auth/namespace/list": {
      code: 200,
      data: { namespaces: [PERSONAL, TEAM] },
    },
    "/api/auth/namespace/switch": {
      code: 200,
      data: { appToken: TEAM_APP_TOKEN, token: TEAM_REGIONAL_TOKEN },
    },
    "/api/auth/regionToken": {
      code: 200,
      data: {
        appToken: PERSONAL_APP_TOKEN,
        kubeconfig: FAKE_KUBECONFIG,
        token: PERSONAL_REGIONAL_TOKEN,
      },
    },
  };
}

export function createFakeDesktop(
  options: FakeDesktopOptions = { answers: defaultDesktopAnswers() }
): {
  calls: RecordedDesktopCall[];
  fetch: DesktopFetch;
} {
  const calls: RecordedDesktopCall[] = [];
  const fetchDesktop: DesktopFetch = (url, init) => {
    const headers = new Headers(init.headers);
    const call: RecordedDesktopCall = {
      authorization: headers.get("authorization"),
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      method: init.method ?? "GET",
      path: url.pathname,
    };
    calls.push(call);
    const configured = options.answers[url.pathname];
    const answer =
      typeof configured === "function" ? configured(call) : configured;
    if (answer == null) {
      return Promise.resolve(new Response("not found", { status: 404 }));
    }
    if (answer instanceof Error) {
      return Promise.reject(answer);
    }
    if (answer instanceof Response) {
      return Promise.resolve(answer);
    }
    return Promise.resolve(
      Response.json({
        code: answer.code,
        data: answer.data ?? null,
        message:
          answer.message ?? (answer.code === 200 ? "Successfully" : "error"),
      })
    );
  };
  return { calls, fetch: fetchDesktop };
}
