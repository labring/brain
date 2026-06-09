import assert from "node:assert/strict";
import { test } from "node:test";

import type { BrainProject } from "@/lib/project-persistence/projects";
import type { ServerCredentials } from "@/lib/server-credentials";
import { authorizeTemplateDeployIdentity } from "./auth";

const SERVER_KUBECONFIG = encodeURIComponent("apiVersion: v1\nserver");
const CALLER_KUBECONFIG = encodeURIComponent("apiVersion: v1\ncaller");

const PROJECT: BrainProject = {
  createdAt: "",
  displayName: "Project",
  id: "project-uid",
  namespace: "ns-admin",
  updatedAt: "",
};

const SERVER_CREDENTIALS: ServerCredentials = {
  serverEncodedKubeconfig: SERVER_KUBECONFIG,
  serverNamespace: "ns-admin",
};

function authorize(
  input: Partial<Parameters<typeof authorizeTemplateDeployIdentity>[0]> = {}
) {
  return authorizeTemplateDeployIdentity({
    devBypass: false,
    devEncodedKubeconfig: "",
    devNamespace: "",
    encodedKubeconfig: SERVER_KUBECONFIG,
    namespace: "ns-admin",
    project: PROJECT,
    serverCredentials: SERVER_CREDENTIALS,
    ...input,
  });
}

test("template deploy auth forwards authenticated server kubeconfig", () => {
  const result = authorize({ encodedKubeconfig: SERVER_KUBECONFIG });

  assert.deepEqual(result, {
    encodedKubeconfig: SERVER_KUBECONFIG,
    ok: true,
  });
});

test("template deploy auth rejects kubeconfig that differs from authenticated session", () => {
  const result = authorize({ encodedKubeconfig: CALLER_KUBECONFIG });

  assert.deepEqual(result, {
    message: "kubeconfig does not match authenticated Sealos session.",
    ok: false,
    status: 403,
  });
});

test("template deploy dev bypass rejects arbitrary kubeconfig", () => {
  const result = authorize({
    devBypass: true,
    devEncodedKubeconfig: SERVER_KUBECONFIG,
    encodedKubeconfig: CALLER_KUBECONFIG,
    serverCredentials: {
      serverEncodedKubeconfig: "",
      serverNamespace: "",
    },
  });

  assert.deepEqual(result, {
    message: "kubeconfig does not match local dev credentials.",
    ok: false,
    status: 403,
  });
});

test("template deploy auth rejects inaccessible namespaces", () => {
  const result = authorize({ namespace: "other-ns" });

  assert.deepEqual(result, {
    message: "Project namespace is not accessible.",
    ok: false,
    status: 403,
  });
});

test("template deploy auth rejects missing projects", () => {
  const result = authorize({ project: null });

  assert.deepEqual(result, {
    message: "Project not found.",
    ok: false,
    status: 404,
  });
});
