import { describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildManagedResourceDiscoveryCommand,
  buildManagedResourceObservationCommand,
  MANAGED_READINESS_RESOURCE_TYPES,
  type ManagedResourceObservation,
  managedObservedResourceRefs,
  parseManagedResourceDiscovery,
  parseManagedResourceObservations,
  verifyManagedWorkloadReadiness,
} from "./managed-deployment-verifier";

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

describe("managed deployment Brain verification", () => {
  it("uses only Agent-reported workloads and accepts a Ready Pod", () => {
    const pod = observation("Pod", "web-pod");
    expect(
      verifyManagedWorkloadReadiness({
        workloads: [pod.resource],
        observations: [pod],
      })
    ).toEqual({ ok: true, violations: [] });
  });

  it("rejects completion when the reported workload is not Ready", () => {
    const pod = observation("Pod", "web-pod");
    if (pod.snapshot == null) {
      throw new Error("pod observation fixture is empty");
    }
    pod.snapshot.conditions = [{ status: "False", type: "Ready" }];
    expect(
      verifyManagedWorkloadReadiness({
        workloads: [pod.resource],
        observations: [pod],
      }).ok
    ).toBe(false);
  });

  it("rejects an unready reported workload", () => {
    const deployment = observation("Deployment", "web");
    if (deployment.snapshot == null) {
      throw new Error("deployment observation fixture is empty");
    }
    deployment.snapshot.status = {
      availableReplicas: 0,
      observedGeneration: 1,
      readyReplicas: 0,
    };
    const result = verifyManagedWorkloadReadiness({
      observations: [deployment],
      workloads: [deployment.resource],
    });
    expect(result.ok).toBe(false);
    expect(result.violations).toContain("Deployment/web is not ready");
  });

  it("does not wait for Deployment Available replicas after Ready replicas converge", () => {
    const deployment = observation("Deployment", "web");
    if (deployment.snapshot == null) {
      throw new Error("deployment observation fixture is empty");
    }
    deployment.snapshot.status = {
      availableReplicas: 0,
      observedGeneration: 1,
      readyReplicas: 1,
    };

    expect(
      verifyManagedWorkloadReadiness({
        observations: [deployment],
        workloads: [deployment.resource],
      })
    ).toEqual({ ok: true, violations: [] });
  });

  it("accepts a non-suspended CronJob as runtime evidence", () => {
    const cronJob = observation("CronJob", "cleanup");
    expect(
      verifyManagedWorkloadReadiness({
        observations: [cronJob],
        workloads: [cronJob.resource],
      })
    ).toEqual({ ok: true, violations: [] });
  });

  it("requires the Pod Ready condition instead of accepting Running phase", () => {
    const pod = observation("Pod", "web-pod");
    if (pod.snapshot == null) {
      throw new Error("pod observation fixture is empty");
    }
    pod.snapshot.conditions = [
      { status: "False", type: "Ready" },
      { status: "True", type: "ContainersReady" },
    ];
    pod.snapshot.status = { phase: "Running" };

    const result = verifyManagedWorkloadReadiness({
      observations: [pod],
      workloads: [pod.resource],
    });
    expect(result.ok).toBe(false);
    expect(result.violations).toContain("Pod/web-pod is not ready");
  });

  it("requires at least one ready runtime workload among the report", () => {
    const service = observation("Service", "web");
    const result = verifyManagedWorkloadReadiness({
      observations: [service],
      workloads: [service.resource],
    });
    expect(result.ok).toBe(false);
    expect(result.violations).toContain(
      "no reported runtime or public entry is Ready"
    );
  });

  it("accepts a ready public entry as result evidence", () => {
    const service = observation("Service", "web");
    expect(
      verifyManagedWorkloadReadiness({
        observations: [service],
        publicEntryReady: true,
        workloads: [service.resource],
      })
    ).toEqual({ ok: true, violations: [] });
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
