import { describe, expect, it } from "bun:test";

import type {
  ManagedResourceRef,
  ManagedVerifyReport,
} from "./managed-deployment-contract";
import {
  type ManagedResourceObservation,
  managedIdentityNetworkHosts,
  managedIngressHosts,
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

function identityResources(
  observations: readonly ManagedResourceObservation[]
): ManagedResourceRef[] {
  return observations.map((item) => ({ ...item.resource }));
}

function verify(
  observations: ManagedResourceObservation[]
): ReturnType<typeof verifyManagedResourceObservations> {
  return verifyManagedResourceObservations({
    identityResources: identityResources(observations),
    instanceName: "demo-template",
    observations,
    projectId: "project-1",
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

  it("rejects an allocated Instance with the wrong Project identity", () => {
    const instance = observation("Instance", "demo-template");
    if (instance.snapshot == null) {
      throw new Error("instance observation fixture is empty");
    }
    instance.snapshot.labels["brain.io/project-id"] = "another-project";

    const result = verify([instance, observation("Deployment", "web")]);

    expect(result.ok).toBe(false);
    expect(result.violations).toContain(
      "Instance/demo-template is outside the allocated identity"
    );
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

  it("excludes network targets outside the allocated identity", () => {
    const ownedIngress = observation("Ingress", "web");
    const unrelatedIngress = observation("Ingress", "other");
    const unrelatedService = observation("Service", "other");
    for (const ingress of [ownedIngress, unrelatedIngress]) {
      if (ingress.snapshot == null) {
        throw new Error("ingress observation fixture is empty");
      }
      ingress.snapshot.spec = {
        rules: [{ host: `${ingress.resource.name}.example.sealos.io` }],
      };
    }
    for (const unrelated of [unrelatedIngress, unrelatedService]) {
      if (unrelated.snapshot == null) {
        throw new Error("network observation fixture is empty");
      }
      unrelated.snapshot.labels = {
        "brain.io/deployment-name": "another-template",
        "brain.io/project-id": "another-project",
      };
    }

    const networkObservations = [
      ownedIngress,
      observation("Service", "web"),
      unrelatedIngress,
      unrelatedService,
    ];
    expect(
      managedIdentityNetworkHosts({
        identityResources: identityResources(networkObservations.slice(0, 2)),
        instanceName: "demo-template",
        observations: networkObservations,
        projectId: "project-1",
      })
    ).toEqual({
      publicHosts: ["web.example.sealos.io"],
      serviceHosts: ["web.ns-1.svc.cluster.local"],
    });
  });
});
