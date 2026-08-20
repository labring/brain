import { describe, expect, test } from "bun:test";

import {
  isUserNamespace,
  listDevboxes,
  parseArgs,
  reasonsFor,
} from "./devbox-admin-cleanup.mjs";

function shutdownDevbox() {
  const name = "sealai-deploy-0123456789abcdef0123";
  return {
    metadata: {
      annotations: {
        "devbox.sealos.io/archive-after-pause-time": "24h0m0s",
        "devbox.sealos.io/archive-triggered-at": "2026-08-02T00:00:00Z",
        "devbox.sealos.io/paused-at": "2026-08-01T00:00:00Z",
      },
      creationTimestamp: "2026-08-01T00:00:00Z",
      finalizers: ["devbox.sealos.io/finalizer"],
      labels: {
        "app.kubernetes.io/component": "deploy-runtime",
        "app.kubernetes.io/managed-by": "sealai",
        "devbox.sealos.io/lifecycle-scheduled": "true",
        "devbox.sealos.io/upstream-id": `${name}abcdef123456`,
      },
      name,
      namespace: "ns-admin",
      resourceVersion: "123",
      uid: "devbox-uid",
    },
    spec: { state: "Shutdown" },
    status: { phase: "Shutdown", state: "Shutdown" },
  };
}

describe("devbox admin cleanup", () => {
  test("accepts only user namespace names", () => {
    expect(isUserNamespace("ns-admin")).toBe(true);
    expect(isUserNamespace("ns-user-1")).toBe(true);
    expect(isUserNamespace("kube-system")).toBe(false);
    expect(isUserNamespace("sealos-system")).toBe(false);
    expect(isUserNamespace(undefined)).toBe(false);
  });

  test("requires an explicit kubeconfig and user namespace", () => {
    expect(() => parseArgs(["inventory", "--namespace", "ns-admin"])).toThrow(
      "--kubeconfig is required"
    );
    expect(() =>
      parseArgs([
        "inventory",
        "--namespace",
        "kube-system",
        "--kubeconfig",
        "/tmp/staging-admin.yaml",
      ])
    ).toThrow("--namespace must start with ns-");

    expect(
      parseArgs([
        "inventory",
        "--all-namespaces",
        "--kubeconfig",
        "/tmp/staging-admin.yaml",
      ])
    ).toMatchObject({
      allNamespaces: true,
      kubeconfig: "/tmp/staging-admin.yaml",
    });
  });

  test("lists Devboxes only from ns-* namespaces in all-namespaces mode", async () => {
    const listedNamespaces = [];
    const core = {
      listNamespace: async () => ({
        body: {
          items: [
            { metadata: { name: "kube-system" } },
            { metadata: { name: "ns-admin" } },
            { metadata: { name: "ns-user-1" } },
            { metadata: { name: "sealos-system" } },
          ],
        },
      }),
    };
    const api = {
      listNamespacedCustomObject: (_group, _version, namespace) => {
        listedNamespaces.push(namespace);
        return { body: { items: [{ metadata: { namespace } }] } };
      },
    };

    const objects = await listDevboxes(api, core, {
      allNamespaces: true,
      namespace: null,
    });

    expect(listedNamespaces.sort()).toEqual(["ns-admin", "ns-user-1"]);
    expect(objects).toHaveLength(2);
  });

  test("keeps a Shutdown deploy Devbox eligible without task lookup", () => {
    const evaluation = reasonsFor(shutdownDevbox(), {
      allNamespaces: false,
      includeDebug: false,
      namespace: "ns-admin",
      now: new Date("2026-08-03T00:00:00Z"),
    });

    expect(evaluation.reasons).toEqual([]);
    expect(evaluation.state).toEqual({
      phase: "Shutdown",
      spec: "Shutdown",
      status: "Shutdown",
    });
  });
});
