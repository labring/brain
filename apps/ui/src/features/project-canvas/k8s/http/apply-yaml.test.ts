import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { applyBrainProductManifest, k8sApplyYaml } from "./apply-yaml";

const originalFetch = globalThis.fetch;
const EXPECTED_BRAIN_PRODUCT_ERROR = /Expected Brain direct AP\/DB manifest/;
const DIRECT_PRODUCT_K8S_APPLY_ERROR =
  /must be submitted through AP\/DB product APIs/;

interface FetchCall {
  body: string | undefined;
  method: string | undefined;
  url: string;
}

function mockFetch(calls: FetchCall[]) {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      body: typeof init?.body === "string" ? init.body : undefined,
      method: init?.method,
      url: String(input),
    });
    return Promise.resolve(
      new Response("{}", {
        headers: { "Content-Type": "application/json" },
        status: 200,
      })
    );
  }) as typeof fetch;
}

function onlyCall(calls: FetchCall[]): FetchCall {
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.ok(call);
  return call;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("applyBrainProductManifest sends AP manifests to the AP product API", async () => {
  const calls: FetchCall[] = [];
  mockFetch(calls);

  await applyBrainProductManifest(
    "kubeconfig",
    `apiVersion: brain.io/direct
kind: AP
metadata:
  name: web
  namespace: ns-admin
spec:
  projectId: project-1
`
  );

  const call = onlyCall(calls);
  assert.equal(call.method, "PUT");
  assert.equal(new URL(call.url).pathname, "/api/ap/v1alpha1");
});

test("applyBrainProductManifest sends DB manifests to the DB product API", async () => {
  const calls: FetchCall[] = [];
  mockFetch(calls);

  await applyBrainProductManifest(
    "kubeconfig",
    `apiVersion: brain.io/direct
kind: DB
metadata:
  name: pg
  namespace: ns-admin
spec:
  projectId: project-1
  engine: postgresql
`
  );

  const call = onlyCall(calls);
  assert.equal(call.method, "PUT");
  assert.equal(new URL(call.url).pathname, "/api/db/v1alpha1");
});

test("applyBrainProductManifest rejects native Kubernetes manifests", async () => {
  const calls: FetchCall[] = [];
  mockFetch(calls);

  await assert.rejects(
    applyBrainProductManifest(
      "kubeconfig",
      `apiVersion: v1
kind: Secret
metadata:
  name: token
`
    ),
    EXPECTED_BRAIN_PRODUCT_ERROR
  );
  assert.equal(calls.length, 0);
});

test("k8sApplyYaml rejects Brain direct product manifests", async () => {
  const calls: FetchCall[] = [];
  mockFetch(calls);

  await assert.rejects(
    k8sApplyYaml(
      "kubeconfig",
      `apiVersion: brain.io/direct
kind: AP
metadata:
  name: web
`
    ),
    DIRECT_PRODUCT_K8S_APPLY_ERROR
  );
  assert.equal(calls.length, 0);
});

test("k8sApplyYaml still applies native Kubernetes manifests", async () => {
  const calls: FetchCall[] = [];
  mockFetch(calls);

  await k8sApplyYaml(
    "kubeconfig",
    `apiVersion: v1
kind: Secret
metadata:
  name: token
`
  );

  const call = onlyCall(calls);
  assert.equal(call.method, "POST");
  assert.equal(new URL(call.url).pathname, "/api/k8s/v1alpha1/apply");
});
