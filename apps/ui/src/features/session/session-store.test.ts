import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createStore } from "jotai";

import {
  appTokenAtom,
  currentWorkspaceAtom,
  desktopUserNameAtom,
  kubeconfigAtom,
  namespaceAtom,
  regionalTokenAtom,
  sessionStatusAtom,
  sessionUserAtom,
  workspacesAtom,
} from "@/lib/auth-store";

import type { SessionFetch } from "./session-client";
import type { BrainSession } from "./session-schema";
import {
  applyBrainSession,
  establishSession,
  markSessionExpired,
} from "./session-store";

const PERSONAL = {
  createdAt: "2026-01-01T00:00:00.000Z",
  id: "ns-abc",
  isPersonal: true,
  name: "private team",
  role: "Owner" as const,
  uid: "uid-personal",
};

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
    kubeconfig:
      "apiVersion: v1\ncurrent-context: c\ncontexts:\n  - name: c\n    context:\n      namespace: ns-team\n",
    namespace: "ns-team",
    regionalToken: "regional-1",
    user: {
      avatar: "",
      crName: "abc",
      name: "Ada",
      userId: "user-id",
      userUid: "user-uid",
    },
    workspace: TEAM,
    workspaces: [PERSONAL, TEAM],
    ...overrides,
  };
}

function fetchAnswering(
  respond: (body: unknown) => Response | Promise<Response>
): { calls: unknown[]; fetchImpl: SessionFetch } {
  const calls: unknown[] = [];
  return {
    calls,
    fetchImpl: (_url, init) => {
      const body = JSON.parse(String(init.body));
      calls.push(body);
      return Promise.resolve(respond(body));
    },
  };
}

describe("applyBrainSession", () => {
  test("writes every credential and Workspace fact into the atoms and marks the session ready", () => {
    const store = createStore();
    applyBrainSession(store, session());
    assert.equal(store.get(kubeconfigAtom).includes("ns-team"), true);
    assert.equal(store.get(namespaceAtom), "ns-team");
    assert.equal(store.get(appTokenAtom), "app-1");
    assert.equal(store.get(regionalTokenAtom), "regional-1");
    assert.deepEqual(store.get(currentWorkspaceAtom), TEAM);
    assert.deepEqual(store.get(workspacesAtom), [PERSONAL, TEAM]);
    assert.equal(store.get(sessionUserAtom)?.crName, "abc");
    assert.equal(store.get(desktopUserNameAtom), "Ada");
    assert.deepEqual(store.get(sessionStatusAtom), { kind: "ready" });
  });
});

describe("establishSession", () => {
  test("posts the nsid and applies the session", async () => {
    const store = createStore();
    const desktop = fetchAnswering(() => Response.json(session()));
    const result = await establishSession(store, {
      fetchImpl: desktop.fetchImpl,
      nsid: "ns-team",
    });
    assert.equal(result.kind, "ok");
    assert.deepEqual(desktop.calls, [{ nsid: "ns-team" }]);
    assert.equal(store.get(regionalTokenAtom), "regional-1");
    assert.deepEqual(store.get(sessionStatusAtom), { kind: "ready" });
  });

  test("posts an empty body without a nsid", async () => {
    const store = createStore();
    const desktop = fetchAnswering(() => Response.json(session()));
    await establishSession(store, { fetchImpl: desktop.fetchImpl, nsid: null });
    assert.deepEqual(desktop.calls, [{}]);
  });

  test("a 401 clears the credentials and marks the session expired", async () => {
    const store = createStore();
    applyBrainSession(store, session());
    const desktop = fetchAnswering(() =>
      Response.json({ error: "session_expired" }, { status: 401 })
    );
    const result = await establishSession(store, {
      fetchImpl: desktop.fetchImpl,
      nsid: "ns-team",
    });
    assert.equal(result.kind, "unauthorized");
    assert.deepEqual(store.get(sessionStatusAtom), { kind: "expired" });
    assert.equal(store.get(kubeconfigAtom), "");
    assert.equal(store.get(appTokenAtom), "");
    assert.equal(store.get(regionalTokenAtom), "");
    // the shell keeps its shape under the overlay
    assert.deepEqual(store.get(currentWorkspaceAtom), TEAM);
    assert.equal(store.get(sessionUserAtom)?.name, "Ada");
  });

  test("any other failure records the error code before the first session and keeps a ready session intact", async () => {
    const fresh = createStore();
    const failing = fetchAnswering(() =>
      Response.json({ error: "workspace_not_inited" }, { status: 409 })
    );
    const result = await establishSession(fresh, {
      fetchImpl: failing.fetchImpl,
      nsid: null,
    });
    assert.deepEqual(result, {
      code: "workspace_not_inited",
      kind: "failed",
      status: 409,
    });
    assert.deepEqual(fresh.get(sessionStatusAtom), {
      code: "workspace_not_inited",
      kind: "error",
    });

    const ready = createStore();
    applyBrainSession(ready, session());
    const outage = fetchAnswering(() => Promise.reject(new Error("down")));
    const retried = await establishSession(ready, {
      fetchImpl: outage.fetchImpl,
      nsid: "ns-team",
    });
    assert.equal(retried.kind, "network");
    assert.deepEqual(ready.get(sessionStatusAtom), { kind: "ready" });
    assert.equal(ready.get(regionalTokenAtom), "regional-1");
  });

  test("a malformed session body is a failure, never applied", async () => {
    const store = createStore();
    const desktop = fetchAnswering(() => Response.json({ appToken: "only" }));
    const result = await establishSession(store, {
      fetchImpl: desktop.fetchImpl,
      nsid: null,
    });
    assert.equal(result.kind, "failed");
    assert.equal(store.get(appTokenAtom), "");
  });

  test("concurrent establishes against one store share a single request", async () => {
    const store = createStore();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const desktop = fetchAnswering(async () => {
      await gate;
      return Response.json(session());
    });
    const first = establishSession(store, {
      fetchImpl: desktop.fetchImpl,
      nsid: "ns-team",
    });
    const second = establishSession(store, {
      fetchImpl: desktop.fetchImpl,
      nsid: "ns-team",
    });
    assert.deepEqual(store.get(sessionStatusAtom), { kind: "establishing" });
    release();
    const [a, b] = await Promise.all([first, second]);
    assert.equal(a, b);
    assert.equal(desktop.calls.length, 1);

    // and a later establish starts a new request
    await establishSession(store, {
      fetchImpl: desktop.fetchImpl,
      nsid: "ns-team",
    });
    assert.equal(desktop.calls.length, 2);
  });
});

describe("markSessionExpired", () => {
  test("drops the three credentials and raises the expired status", () => {
    const store = createStore();
    applyBrainSession(store, session());
    markSessionExpired(store);
    assert.equal(store.get(kubeconfigAtom), "");
    assert.equal(store.get(appTokenAtom), "");
    assert.equal(store.get(regionalTokenAtom), "");
    assert.deepEqual(store.get(sessionStatusAtom), { kind: "expired" });
  });
});
