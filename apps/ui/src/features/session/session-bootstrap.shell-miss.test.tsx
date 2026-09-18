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
import { appTokenAtom, kubeconfigAtom, sessionStatusAtom } from "@/lib/auth-store";

import type { BrainSession } from "./session-schema";

// The Desktop SDK double: `nsid` is switchable so one file covers both the
// missed handshake (empty `nsid`) and the no-shell local-dev landing. The
// component's own `desktop-sdk` reading layer stays real.
const sdkState = { nsid: "" };

mock.module("@labring/sealos-desktop-sdk", () => ({
  EVENT_NAME: { CHANGE_I18N: "change_i18n", GET_APPS: "get-apps" },
}));
mock.module("@labring/sealos-desktop-sdk/app", () => ({
  createSealosApp: () => () => undefined,
  sealosApp: {
    addAppEventListen: () => () => undefined,
    getHostConfig: async () => ({
      cloud: { domain: "cloud.test", port: "", regionUid: "r" },
    }),
    getLanguage: async () => ({ lng: "en" }),
    getSession: async () => ({
      kubeconfig: "never-read",
      token: "never-read",
      user: {
        avatar: "",
        id: "x",
        k8sUsername: "x",
        name: "x",
        nsid: sdkState.nsid,
      },
    }),
  },
}));
mock.module("sonner", () => ({
  toast: () => undefined,
}));

const PERSONAL_WORKSPACE = {
  createdAt: "2026-02-01T00:00:00.000Z",
  id: "ns-personal",
  isPersonal: true,
  name: "Ada",
  role: "Owner" as const,
  uid: "uid-personal",
};

const PERSONAL: BrainSession = {
  appToken: "app-1",
  kubeconfig: "apiVersion: v1\ncurrent-context: c\n",
  namespace: "ns-personal",
  regionalToken: "regional-1",
  user: {
    avatar: "",
    crName: "abc",
    name: "Ada",
    userId: "u",
    userUid: "uu",
  },
  workspace: PERSONAL_WORKSPACE,
  workspaces: [PERSONAL_WORKSPACE],
};

const sessionRequests: unknown[] = [];

function fetchStub(input: unknown, init?: RequestInit): Promise<Response> {
  const url = requestUrl(input);
  if (url === "/api/session") {
    sessionRequests.push(JSON.parse(String(init?.body)));
    return Promise.resolve(Response.json(PERSONAL));
  }
  return Promise.resolve(new Response("{}", { status: 404 }));
}

let dom: TestDom;
let actEnvironment: boolean | undefined;
let fetchOverride: GlobalOverride;
let topDescriptor: PropertyDescriptor | undefined;

/** Stands a parent frame over the window, as the Desktop iframe would. */
function pretendInsideIframe() {
  topDescriptor = Object.getOwnPropertyDescriptor(window, "top");
  Object.defineProperty(window, "top", {
    configurable: true,
    value: { location: { href: "about:blank" } },
  });
}

function restoreTop() {
  if (topDescriptor == null) {
    Reflect.deleteProperty(window, "top");
    return;
  }
  Object.defineProperty(window, "top", topDescriptor);
}

beforeEach(() => {
  dom = installTestDom();
  actEnvironment = setActEnvironment(true);
  fetchOverride = defineGlobal("fetch", fetchStub);
  sessionRequests.length = 0;
  sdkState.nsid = "";
  const store = getDefaultStore();
  store.set(sessionStatusAtom, { kind: "idle" });
  store.set(kubeconfigAtom, "");
  store.set(appTokenAtom, "");
});

afterEach(async () => {
  restoreTop();
  restoreGlobal(fetchOverride);
  restoreActEnvironment(actEnvironment);
  await dom.restore();
});

async function withBootstrap(run: () => void) {
  const { render } = await import("@testing-library/react/pure");
  const { JotaiProvider } = await import("@/features/shell/jotai-provider");
  const { SessionBootstrap } = await import("./session-bootstrap");
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

test("inside the iframe a missed SDK handshake is an error, never a guess at Personal", async () => {
  pretendInsideIframe();
  await withBootstrap(() => {
    const store = getDefaultStore();
    assert.deepEqual(store.get(sessionStatusAtom), {
      code: "desktop_unavailable",
      kind: "error",
    });
    assert.deepEqual(sessionRequests, [], "no session was established");
    assert.equal(store.get(kubeconfigAtom), "");
    assert.notEqual(
      document.querySelector('[data-slot="session-error"]'),
      null,
      "error overlay is up"
    );
  });
});

test("outside an iframe a missing shell still lands in the Personal Workspace", async () => {
  await withBootstrap(() => {
    const store = getDefaultStore();
    assert.deepEqual(sessionRequests, [{}], "posted without an nsid");
    assert.deepEqual(store.get(sessionStatusAtom), { kind: "ready" });
    assert.equal(store.get(kubeconfigAtom), PERSONAL.kubeconfig);
  });
});
