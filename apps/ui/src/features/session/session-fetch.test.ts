import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createStore } from "jotai";

import {
  appTokenAtom,
  regionalTokenAtom,
  sessionStatusAtom,
} from "@/lib/auth-store";
import { REGION_TOKEN_HEADER } from "@/lib/region-token-header";

import type { SessionFetch } from "./session-client";
import { createSessionFetch } from "./session-fetch";
import type { BrainSession } from "./session-schema";
import { applyBrainSession } from "./session-store";

const WORKSPACE = {
  createdAt: "2026-02-01T00:00:00.000Z",
  id: "ns-team",
  isPersonal: false,
  name: "Acme",
  role: "Owner" as const,
  uid: "uid-team",
};

function session(tokens: {
  appToken: string;
  regionalToken: string;
}): BrainSession {
  return {
    appToken: tokens.appToken,
    kubeconfig: "apiVersion: v1\ncurrent-context: c\n",
    namespace: "ns-team",
    regionalToken: tokens.regionalToken,
    user: {
      avatar: "",
      crName: "abc",
      name: "Ada",
      userId: "u",
      userUid: "uu",
    },
    workspace: WORKSPACE,
    workspaces: [WORKSPACE],
  };
}

interface Seen {
  regionToken: string | null;
  url: string;
}

function harness(input: {
  answers: number[];
  reexchange: (body: unknown) => Response | Promise<Response>;
}) {
  const store = createStore();
  applyBrainSession(
    store,
    session({ appToken: "app-1", regionalToken: "regional-1" })
  );
  const seen: Seen[] = [];
  const sessionCalls: unknown[] = [];
  const answers = [...input.answers];
  const fetchImpl = (url: string, init?: RequestInit) => {
    seen.push({
      regionToken: new Headers(init?.headers).get(REGION_TOKEN_HEADER),
      url,
    });
    const status = answers.shift() ?? 200;
    return Promise.resolve(
      new Response(status === 200 ? '{"ok":true}' : null, { status })
    );
  };
  const sessionFetchImpl: SessionFetch = (_url, init) => {
    const body = JSON.parse(String(init.body));
    sessionCalls.push(body);
    return Promise.resolve(input.reexchange(body));
  };
  return {
    fetch: createSessionFetch({ fetchImpl, sessionFetchImpl, store }),
    seen,
    sessionCalls,
    store,
  };
}

describe("createSessionFetch", () => {
  test("attaches the regional token header and passes a non-401 answer through", async () => {
    const h = harness({
      answers: [200],
      reexchange: () => new Response(null, { status: 500 }),
    });
    const response = await h.fetch("/api/workspace/list", { method: "GET" });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.deepEqual(h.seen, [
      { regionToken: "regional-1", url: "/api/workspace/list" },
    ]);
    assert.deepEqual(h.sessionCalls, []);
  });

  test("on 401 re-establishes the session for the current Workspace and retries once with the new token", async () => {
    const h = harness({
      answers: [401, 200],
      reexchange: () =>
        Response.json(
          session({ appToken: "app-2", regionalToken: "regional-2" })
        ),
    });
    const response = await h.fetch("/api/workspace/list", { method: "GET" });
    assert.equal(response.status, 200);
    assert.deepEqual(h.sessionCalls, [{ nsid: "ns-team" }]);
    assert.deepEqual(
      h.seen.map((call) => call.regionToken),
      ["regional-1", "regional-2"]
    );
    // the atoms updated in place, so every credential-keyed cache moves on
    assert.equal(h.store.get(appTokenAtom), "app-2");
    assert.equal(h.store.get(regionalTokenAtom), "regional-2");
    assert.deepEqual(h.store.get(sessionStatusAtom), { kind: "ready" });
  });

  test("a second 401 after the re-exchange marks the session expired", async () => {
    const h = harness({
      answers: [401, 401],
      reexchange: () =>
        Response.json(
          session({ appToken: "app-2", regionalToken: "regional-2" })
        ),
    });
    const response = await h.fetch("/api/workspace/list", { method: "GET" });
    assert.equal(response.status, 401);
    assert.equal(h.seen.length, 2);
    assert.deepEqual(h.store.get(sessionStatusAtom), { kind: "expired" });
    assert.equal(h.store.get(regionalTokenAtom), "");
  });

  test("a 401 from the re-exchange itself marks the session expired without a retry", async () => {
    const h = harness({
      answers: [401, 200],
      reexchange: () => new Response(null, { status: 401 }),
    });
    const response = await h.fetch("/api/workspace/list", { method: "GET" });
    assert.equal(response.status, 401);
    assert.equal(h.seen.length, 1);
    assert.deepEqual(h.store.get(sessionStatusAtom), { kind: "expired" });
  });

  test("a failed re-exchange (Desktop outage) hands the original 401 back and keeps the credentials", async () => {
    const h = harness({
      answers: [401, 200],
      reexchange: () => new Response(null, { status: 502 }),
    });
    const response = await h.fetch("/api/workspace/list", { method: "GET" });
    assert.equal(response.status, 401);
    assert.equal(h.seen.length, 1);
    assert.deepEqual(h.store.get(sessionStatusAtom), { kind: "ready" });
    assert.equal(h.store.get(regionalTokenAtom), "regional-1");
  });
});
