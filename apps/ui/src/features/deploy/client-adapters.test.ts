import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { createDeploymentTaskFromApi } from "./client-adapters";
import type { DeploymentTaskCreateInput } from "./pipeline";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function captureAppTokenHeaders(): (string | null)[] {
  const headers: (string | null)[] = [];
  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
    headers.push(new Headers(init?.headers).get("X-Sealos-App-Token"));
    return Promise.resolve(Response.json({ task: { id: "task-1" } }));
  }) as typeof fetch;
  return headers;
}

function createInput(
  source: DeploymentTaskCreateInput["source"]
): DeploymentTaskCreateInput {
  return {
    namespace: "shared",
    runner: { kind: "direct" },
    source,
    target: { kind: "newProject" },
  };
}

test("GitHub-source creation attaches the app token", async () => {
  const headers = captureAppTokenHeaders();
  await createDeploymentTaskFromApi({
    appToken: "app-token",
    encodedKubeconfig: "encoded-kubeconfig",
    input: createInput({
      kind: "github",
      repo: { fullName: "acme/app", name: "app", url: "https://x.test/app" },
    }),
  });
  assert.deepEqual(headers, ["app-token"]);
});

test("namespace-shared source creation never carries the app token", async () => {
  const headers = captureAppTokenHeaders();
  await createDeploymentTaskFromApi({
    appToken: "app-token",
    encodedKubeconfig: "encoded-kubeconfig",
    input: createInput({ kind: "database", settings: {} }),
  });
  await createDeploymentTaskFromApi({
    appToken: "app-token",
    encodedKubeconfig: "encoded-kubeconfig",
    input: createInput({ kind: "docker", settings: {} }),
  });
  await createDeploymentTaskFromApi({
    appToken: "app-token",
    encodedKubeconfig: "encoded-kubeconfig",
    input: createInput({ kind: "template", templateName: "postgres" }),
  });
  assert.deepEqual(headers, [null, null, null]);
});
