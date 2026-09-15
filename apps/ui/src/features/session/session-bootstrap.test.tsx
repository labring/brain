import { afterEach, beforeEach, mock, test } from "bun:test";
import assert from "node:assert/strict";
import { getDefaultStore } from "jotai";

import {
  actAndDrain,
  defineGlobal,
  type GlobalOverride,
  installTestDom,
  requestUrl,
  restoreActEnvironment,
  restoreGlobal,
  setActEnvironment,
  type TestDom,
} from "@/features/project-canvas/react-test-harness";
import {
  appTokenAtom,
  currentWorkspaceAtom,
  desktopLanguageAtom,
  kubeconfigAtom,
  namespaceAtom,
  regionalTokenAtom,
  sessionStatusAtom,
  sessionUserAtom,
  workspacesAtom,
} from "@/lib/auth-store";

import type { BrainSession } from "./session-schema";

// The SDK double: answers Desktop's current Workspace and language the way
// the Desktop shell (or the local Dev Bridge) does. It never hands out
// credentials — the reading layer's type would not accept them anyway.
const desktopShell = { nsid: "ns-team" };
const toasts: string[] = [];

mock.module("@labring/sealos-desktop-sdk", () => ({
  EVENT_NAME: { CHANGE_I18N: "change_i18n", GET_APPS: "get-apps" },
}));
mock.module("@labring/sealos-desktop-sdk/app", () => ({
  createSealosApp: () => () => undefined,
  sealosApp: {
    addAppEventListen: () => () => undefined,
    getHostConfig: async () => ({
      cloud: { domain: "cloud.test", port: "", regionUid: "r" },
      features: { subscription: true },
    }),
    getLanguage: async () => ({ lng: "zh" }),
    getSession: async () => ({
      kubeconfig: "never-read",
      token: "never-read",
      user: {
        avatar: "",
        id: "x",
        k8sUsername: "x",
        name: "x",
        nsid: desktopShell.nsid,
      },
    }),
  },
}));
mock.module("sonner", () => ({
  toast: (message: string) => {
    toasts.push(message);
  },
}));

const moduleDom = installTestDom();
const { render } = await import("@testing-library/react/pure");
const { JotaiProvider } = await import("@/features/shell/jotai-provider");
const { NOT_MEMBER_NOTICE, SessionBootstrap } = await import(
  "./session-bootstrap"
);
const { desktopSigninUrl } = await import("./session-expired-overlay");
await moduleDom.restore();

const TEAM = {
  createdAt: "2026-02-01T00:00:00.000Z",
  id: "ns-team",
  isPersonal: false,
  name: "Acme",
  role: "Manager" as const,
  uid: "uid-team",
};

function session(overrides: Partial<BrainSession> = {}): BrainSession {
  return {
    appToken: "app-1",
    kubeconfig: "apiVersion: v1\ncurrent-context: c\n",
    namespace: "ns-team",
    regionalToken: "regional-1",
    user: {
      avatar: "",
      crName: "abc",
      name: "Ada",
      userId: "u",
      userUid: "uu",
    },
    workspace: TEAM,
    workspaces: [TEAM],
    ...overrides,
  };
}

const sessionRoute = {
  requests: [] as unknown[],
  respond: (): Response => Response.json(session()),
};

function fetchStub(input: unknown, init?: RequestInit): Promise<Response> {
  const url = requestUrl(input);
  if (url === "/api/session") {
    sessionRoute.requests.push(JSON.parse(String(init?.body)));
    return Promise.resolve(sessionRoute.respond());
  }
  return Promise.resolve(new Response("{}", { status: 404 }));
}

let dom: TestDom;
let actEnvironment: boolean | undefined;
let fetchOverride: GlobalOverride;

beforeEach(() => {
  dom = installTestDom();
  actEnvironment = setActEnvironment(true);
  fetchOverride = defineGlobal("fetch", fetchStub);
  sessionRoute.requests = [];
  sessionRoute.respond = () => Response.json(session());
  toasts.length = 0;
  const store = getDefaultStore();
  store.set(sessionStatusAtom, { kind: "idle" });
  store.set(kubeconfigAtom, "");
  store.set(appTokenAtom, "");
  store.set(regionalTokenAtom, "");
});

afterEach(async () => {
  restoreGlobal(fetchOverride);
  restoreActEnvironment(actEnvironment);
  await dom.restore();
});

async function withBootstrap(run: () => void) {
  let rendered: ReturnType<typeof render> | undefined;
  try {
    await actAndDrain(() => {
      rendered = render(
        <JotaiProvider>
          <SessionBootstrap />
        </JotaiProvider>
      );
    }, 50);
    run();
  } finally {
    await actAndDrain(() => {
      rendered?.unmount();
    });
  }
}

test("reads Desktop's nsid through the SDK, posts it to /api/session, and lands the session in the atoms", async () => {
  await withBootstrap(() => {
    const store = getDefaultStore();
    assert.deepEqual(sessionRoute.requests, [{ nsid: "ns-team" }]);
    assert.equal(store.get(regionalTokenAtom), "regional-1");
    assert.equal(store.get(appTokenAtom), "app-1");
    assert.equal(store.get(namespaceAtom), "ns-team");
    assert.deepEqual(store.get(currentWorkspaceAtom), TEAM);
    assert.deepEqual(store.get(workspacesAtom), [TEAM]);
    assert.equal(store.get(sessionUserAtom)?.name, "Ada");
    assert.equal(store.get(desktopLanguageAtom), "zh");
    assert.deepEqual(store.get(sessionStatusAtom), { kind: "ready" });
    assert.deepEqual(toasts, []);
    assert.equal(document.querySelector('[data-slot="session-expired"]'), null);
  });
});

test("a not_member fallback lands in Personal and tells the user", async () => {
  sessionRoute.respond = () =>
    Response.json(session({ fallback: "not_member" }));
  await withBootstrap(() => {
    assert.deepEqual(toasts, [NOT_MEMBER_NOTICE]);
    assert.deepEqual(getDefaultStore().get(sessionStatusAtom), {
      kind: "ready",
    });
  });
});

test("a 401 from /api/session raises the session-expired overlay and holds no credentials", async () => {
  sessionRoute.respond = () =>
    Response.json({ error: "session_expired" }, { status: 401 });
  await withBootstrap(() => {
    const store = getDefaultStore();
    assert.deepEqual(store.get(sessionStatusAtom), { kind: "expired" });
    assert.equal(store.get(kubeconfigAtom), "");
    assert.equal(store.get(appTokenAtom), "");
    assert.notEqual(
      document.querySelector('[data-slot="session-expired"]'),
      null,
      "overlay is up"
    );
    const button = document.querySelector<HTMLButtonElement>(
      '[data-slot="session-expired"] button'
    );
    assert.notEqual(button, null);
  });
});

test("desktopSigninUrl points at the Desktop sign-in page for the deployment", () => {
  assert.equal(desktopSigninUrl("cloud.test"), "https://cloud.test/signin");
  assert.equal(
    desktopSigninUrl("https://cloud.test/"),
    "https://cloud.test/signin"
  );
  assert.equal(desktopSigninUrl("  "), null);
});
