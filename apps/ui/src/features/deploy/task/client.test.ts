import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { redeployDeploymentTask } from "./client";

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.window = originalWindow;
});

function captureAppTokenHeaders(): (string | null)[] {
  globalThis.window = {
    location: { origin: "https://brain.test" },
  } as unknown as Window & typeof globalThis;
  const headers: (string | null)[] = [];
  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
    headers.push(new Headers(init?.headers).get("X-Sealos-App-Token"));
    return Promise.resolve(Response.json({ task: null }));
  }) as typeof fetch;
  return headers;
}

test("GitHub redeploy attaches the app token", async () => {
  const headers = captureAppTokenHeaders();
  await redeployDeploymentTask({
    appToken: "app-token",
    kubeconfig: "encoded-kubeconfig",
    namespace: "shared",
    predecessorSourceKind: "github",
    predecessorTaskId: "task-1",
  });
  assert.deepEqual(headers, ["app-token"]);
});

test("namespace-shared redeploy keeps the app token private", async () => {
  const headers = captureAppTokenHeaders();
  await redeployDeploymentTask({
    appToken: "app-token",
    kubeconfig: "encoded-kubeconfig",
    namespace: "shared",
    predecessorSourceKind: "template",
    predecessorTaskId: "task-1",
  });
  assert.deepEqual(headers, [null]);
});
