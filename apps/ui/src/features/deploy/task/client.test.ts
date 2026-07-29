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

test("redeploy of a GitHub predecessor attaches the app token", async () => {
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

test("redeploy of a namespace-shared predecessor never carries the app token", async () => {
  const headers = captureAppTokenHeaders();
  for (const kind of ["database", "docker", "template"] as const) {
    await redeployDeploymentTask({
      appToken: "app-token",
      kubeconfig: "encoded-kubeconfig",
      namespace: "shared",
      predecessorSourceKind: kind,
      predecessorTaskId: `task-${kind}`,
    });
  }
  assert.deepEqual(headers, [null, null, null]);
});
