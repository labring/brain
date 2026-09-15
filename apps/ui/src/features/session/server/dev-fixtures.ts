import { resolveDevMock } from "@/features/dev-mock/server/resolve";

import {
  type SessionDevScenario,
  sessionDevMockCookie,
} from "../dev-mock-cookie";
import type { BrainSession, SessionWorkspace } from "../session-schema";

/**
 * Session dev-mock fixtures (dev and demo builds only): one Brain Session
 * per scenario, each staging a Workspace Role the shell must gate on. The
 * credentials are inert fakes — a kubeconfig no apiserver accepts, tokens
 * no verifier signs — so a mock session can never reach a real cluster or
 * account; the other Dev Mocks answer the routes that would consume them.
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

function workspacesFor(scenario: SessionDevScenario): SessionWorkspace[] {
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

function sessionFor(
  scenario: SessionDevScenario,
  requestedNsid: string | null
): BrainSession {
  const workspaces = workspacesFor(scenario);
  const defaultCurrent = workspaces[1] ?? PERSONAL;
  const requested =
    requestedNsid == null
      ? null
      : workspaces.find((workspace) => workspace.id === requestedNsid);
  const current = requested ?? defaultCurrent ?? PERSONAL;
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
