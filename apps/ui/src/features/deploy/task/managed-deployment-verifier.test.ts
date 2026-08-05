import { describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ManagedVerifyReport } from "./managed-deployment-contract";
import {
  buildManagedResourceDiscoveryCommand,
  buildManagedResourceObservationCommand,
  MANAGED_READINESS_RESOURCE_TYPES,
  type ManagedResourceObservation,
  managedIngressHosts,
  managedObservedNetworkHosts,
  managedObservedResourceRefs,
  parseManagedResourceDiscovery,
  parseManagedResourceObservations,
  verifyManagedResourceObservations,
} from "./managed-deployment-verifier";

const report: ManagedVerifyReport = {
  artifacts: [],
  checks: [{ kind: "workload", status: "passed", summary: "ready" }],
  resources: [],
  schemaVersion: 1,
  summary: "verified",
  taskId: "task-1",
  turnId: 1,
  verdict: "passed",
};

function observation(kind: string, name: string): ManagedResourceObservation {
  return {
    endpointsReady: kind === "Service" ? 1 : null,
    error: null,
    resource: { apiVersion: "apps/v1", kind, name, namespace: "ns-1" },
    snapshot: {
      conditions: [{ status: "True", type: "Ready" }],
      generation: 1,
      labels: {
        "brain.io/deployment-name": "demo-template",
        "brain.io/project-id": "project-1",
      },
      ownerReferences: [],
      spec: kind === "Deployment" ? { replicas: 1 } : {},
      status:
        kind === "Deployment"
          ? { availableReplicas: 1, observedGeneration: 1, readyReplicas: 1 }
          : { phase: "Ready" },
    },
  };
}

function verify(
  observations: ManagedResourceObservation[]
): ReturnType<typeof verifyManagedResourceObservations> {
  return verifyManagedResourceObservations({
    instanceName: "demo-template",
    observations,
    report,
  });
}

describe("managed deployment Brain verification", () => {
  it("requires the allocated Instance and ready identity resources", () => {
    const result = verify([
      observation("Instance", "demo-template"),
      observation("Deployment", "web"),
    ]);

    expect(result).toEqual({ ok: true, violations: [] });
  });

  it("rejects an unready resource", () => {
    const deployment = observation("Deployment", "web");
    if (deployment.snapshot == null) {
      throw new Error("deployment observation fixture is empty");
    }
    deployment.snapshot.status = {
      availableReplicas: 0,
      observedGeneration: 1,
      readyReplicas: 0,
    };
    const result = verify([
      observation("Instance", "demo-template"),
      deployment,
    ]);

    expect(result.ok).toBe(false);
    expect(result.violations).toContain("Deployment/web is not ready");
  });

  it("does not use labels as a mutation ownership check", () => {
    const instance = observation("Instance", "demo-template");
    if (instance.snapshot == null) {
      throw new Error("instance observation fixture is empty");
    }
    instance.snapshot.labels["brain.io/project-id"] = "another-project";

    const result = verify([instance, observation("Deployment", "web")]);

    expect(result).toEqual({ ok: true, violations: [] });
  });

  it("rejects an Instance-only self-reported success", () => {
    const result = verify([observation("Instance", "demo-template")]);

    expect(result.ok).toBe(false);
    expect(result.violations).toContain("no runtime workload was observed");
  });

  it("does not require readiness status from controller-derived resources", () => {
    const replicaSet = observation("ReplicaSet", "web-abc123");
    if (replicaSet.snapshot == null) {
      throw new Error("replica set observation fixture is empty");
    }
    replicaSet.snapshot.conditions = [];
    replicaSet.snapshot.status = {};
    replicaSet.snapshot.ownerReferences = [
      { kind: "Instance", name: "demo-template" },
    ];

    const result = verify([
      observation("Instance", "demo-template"),
      observation("Deployment", "web"),
      replicaSet,
    ]);

    expect(result).toEqual({ ok: true, violations: [] });
  });

  it("derives public probe hosts only from observed Ingress rules", () => {
    const ingress = observation("Ingress", "web");
    if (ingress.snapshot == null) {
      throw new Error("ingress observation fixture is empty");
    }
    ingress.snapshot.spec = {
      rules: [
        { host: "app.example.sealos.io" },
        { host: "APP.example.sealos.io" },
      ],
    };

    expect(
      managedIngressHosts([ingress, observation("Service", "web")])
    ).toEqual(["app.example.sealos.io"]);
  });

  it("derives network targets only from the observed verification set", () => {
    const ownedIngress = observation("Ingress", "web");
    if (ownedIngress.snapshot == null) {
      throw new Error("ingress observation fixture is empty");
    }
    ownedIngress.snapshot.spec = {
      rules: [{ host: "web.example.sealos.io" }],
    };

    const networkObservations = [ownedIngress, observation("Service", "web")];
    expect(managedObservedNetworkHosts(networkObservations)).toEqual({
      publicHosts: ["web.example.sealos.io"],
      serviceHosts: ["web.ns-1.svc.cluster.local"],
    });
  });

  it("builds only targeted, bounded Kubernetes verification commands", () => {
    const discovery = buildManagedResourceDiscoveryCommand({
      instanceName: "demo-template",
      namespace: "ns-1",
      projectId: "project-1",
    });
    const observationCommand = buildManagedResourceObservationCommand([
      observation("Deployment", "web").resource,
    ]);

    expect(MANAGED_READINESS_RESOURCE_TYPES).toContain("deployments.apps");
    expect(discovery).not.toContain("api-resources");
    expect(discovery).toContain("--request-timeout=");
    expect(observationCommand).toContain("--request-timeout=");
    expect(observationCommand).not.toContain("spawnSync");
  });

  it("executes targeted discovery and observation without API discovery", () => {
    const directory = mkdtempSync(join(tmpdir(), "sealai-verifier-"));
    const kubectl = join(directory, "kubectl");
    writeFileSync(
      kubectl,
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        `if [[ "\${2:-}" == "endpoints" ]]; then`,
        '  printf \'%s\' \'{"subsets":[{"addresses":[{"ip":"10.0.0.1"}]}]}\'',
        `elif [[ "\${3:-}" == "-n" ]]; then`,
        '  printf \'%s\' \'{"items":[{"apiVersion":"apps/v1","kind":"Deployment","metadata":{"name":"web","namespace":"ns-1"}}]}\'',
        "else",
        '  printf \'%s\' \'{"apiVersion":"apps/v1","kind":"Deployment","metadata":{"generation":1,"labels":{},"name":"web","namespace":"ns-1"},"spec":{"replicas":1},"status":{"availableReplicas":1,"observedGeneration":1,"readyReplicas":1}}\'',
        "fi",
      ].join("\n")
    );
    chmodSync(kubectl, 0o755);
    const env = { ...process.env, PATH: `${directory}:${process.env.PATH}` };

    try {
      const discovery = parseManagedResourceDiscovery(
        execSync(
          buildManagedResourceDiscoveryCommand({
            instanceName: "demo-template",
            namespace: "ns-1",
            projectId: "project-1",
          }),
          { encoding: "utf8", env, shell: "/bin/bash" }
        )
      );
      expect(discovery.errors).toEqual([]);
      expect(discovery.resources.length).toBe(
        MANAGED_READINESS_RESOURCE_TYPES.length
      );

      const observations = parseManagedResourceObservations(
        execSync(
          buildManagedResourceObservationCommand([
            observation("Deployment", "web").resource,
          ]),
          { encoding: "utf8", env, shell: "/bin/bash" }
        )
      );
      expect(observations[0]?.error).toBeNull();
      expect(observations[0]?.snapshot?.status.readyReplicas).toBe(1);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("persists only resources Brain independently observed", () => {
    const ready = observation("Deployment", "web");
    const missing = observation("Service", "missing");
    missing.error = "not found";
    missing.snapshot = null;

    expect(managedObservedResourceRefs([ready, missing])).toEqual([
      ready.resource,
    ]);
  });
});
