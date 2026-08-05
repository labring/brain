import { describe, expect, it } from "bun:test";
import {
  auditManagedDeploymentMutations,
  buildManagedInventoryCommand,
  type ManagedResourceInventory,
  managedIdentityResourceRefs,
} from "./managed-deployment-audit";
import type { ManagedTurnReport } from "./managed-deployment-contract";

function inventory(digest: string): ManagedResourceInventory {
  return {
    errors: [],
    items: [
      {
        apiVersion: "apps/v1",
        digest,
        generation: 1,
        kind: "Deployment",
        labels: {
          "brain.io/deployment-name": "instance-1",
          "brain.io/project-id": "project-1",
        },
        managers: ["sealai-test"],
        name: "web",
        namespace: "ns-1",
        ownerReferences: [],
        uid: "uid-web",
      },
    ],
  };
}

function unrelatedInventory(
  digest: string,
  labels: Record<string, string> = {}
): ManagedResourceInventory {
  const value = inventory(digest);
  const resource = value.items[0];
  if (resource == null) {
    throw new Error("inventory fixture is empty");
  }
  resource.labels = labels;
  return value;
}

function report(mutations: ManagedTurnReport["mutations"]): ManagedTurnReport {
  return {
    diagnostics: [],
    mutations,
    outcome: "applied",
    schemaVersion: 1,
    summary: "applied",
    taskId: "task-1",
    turnId: 1,
  };
}

describe("managed deployment mutation audit", () => {
  it("discovers every namespaced resource type that supports mutation", () => {
    const command = buildManagedInventoryCommand("ns-1");

    expect(command).toContain("api-resources");
    expect(command).toContain("--namespaced=true");
    expect(command).toContain("--verbs=list,");
  });

  it("accepts a declared identity-scoped mutation", () => {
    const result = auditManagedDeploymentMutations({
      after: inventory("b".repeat(64)),
      before: inventory("a".repeat(64)),
      fieldManager: "sealai-test",
      instanceName: "instance-1",
      projectId: "project-1",
      report: report([
        {
          fieldManager: "sealai-test",
          operation: "apply",
          preconditionUid: "uid-web",
          resource: {
            apiVersion: "apps/v1",
            kind: "Deployment",
            name: "web",
            namespace: "ns-1",
            uid: "uid-web",
          },
        },
      ]),
    });

    expect(result.ok).toBe(true);
  });

  it("rejects undeclared and out-of-envelope mutations", () => {
    const after = inventory("b".repeat(64));
    const first = after.items[0];
    if (first == null) {
      throw new Error("inventory fixture is empty");
    }
    after.items[0] = { ...first, labels: {} };
    const result = auditManagedDeploymentMutations({
      after,
      before: inventory("a".repeat(64)),
      fieldManager: "sealai-test",
      instanceName: "instance-1",
      projectId: "project-1",
      report: report([]),
    });

    expect(result.ok).toBe(false);
    expect(result.violations[0]).toContain("undeclared mutation");
  });

  it("rejects claiming an unrelated resource by adding identity labels", () => {
    const result = auditManagedDeploymentMutations({
      after: unrelatedInventory("b".repeat(64), {
        "brain.io/deployment-name": "instance-1",
      }),
      before: unrelatedInventory("a".repeat(64), {
        "brain.io/project-id": "project-1",
      }),
      fieldManager: "sealai-test",
      instanceName: "instance-1",
      projectId: "project-1",
      report: report([
        {
          fieldManager: "sealai-test",
          operation: "apply",
          preconditionUid: "uid-web",
          resource: {
            apiVersion: "apps/v1",
            kind: "Deployment",
            name: "web",
            namespace: "ns-1",
            uid: "uid-web",
          },
        },
      ]),
    });

    expect(result.ok).toBe(false);
    expect(result.violations).toContain(
      "mutation outside identity envelope: apps/v1|Deployment|ns-1|web"
    );
  });

  it("rejects replacing an identity resource during a turn", () => {
    const after = inventory("b".repeat(64));
    const resource = after.items[0];
    if (resource == null) {
      throw new Error("inventory fixture is empty");
    }
    resource.uid = "replacement-uid";

    const result = auditManagedDeploymentMutations({
      after,
      before: inventory("a".repeat(64)),
      fieldManager: "sealai-test",
      instanceName: "instance-1",
      projectId: "project-1",
      report: report([
        {
          fieldManager: "sealai-test",
          operation: "apply",
          preconditionUid: "uid-web",
          resource: {
            apiVersion: "apps/v1",
            kind: "Deployment",
            name: "web",
            namespace: "ns-1",
            uid: "uid-web",
          },
        },
      ]),
    });

    expect(result.ok).toBe(false);
    expect(result.violations).toContain(
      "resource UID changed during turn: apps/v1|Deployment|ns-1|web"
    );
  });

  it("rejects exec against a resource outside the identity envelope", () => {
    const result = auditManagedDeploymentMutations({
      after: unrelatedInventory("a".repeat(64)),
      before: unrelatedInventory("a".repeat(64)),
      fieldManager: "sealai-test",
      instanceName: "instance-1",
      projectId: "project-1",
      report: report([
        {
          operation: "exec",
          preconditionUid: "uid-web",
          resource: {
            apiVersion: "apps/v1",
            kind: "Deployment",
            name: "web",
            namespace: "ns-1",
            uid: "uid-web",
          },
        },
      ]),
    });

    expect(result.ok).toBe(false);
    expect(result.violations).toContain(
      "exec outside identity envelope: apps/v1|Deployment|ns-1|web"
    );
  });

  it("allows controller-owned child creation without an Agent declaration", () => {
    const before = inventory("a".repeat(64));
    const after = inventory("a".repeat(64));
    after.items.push({
      apiVersion: "v1",
      digest: "b".repeat(64),
      generation: null,
      kind: "Pod",
      labels: {},
      managers: ["kube-controller-manager"],
      name: "web-pod",
      namespace: "ns-1",
      ownerReferences: [{ kind: "Deployment", name: "web", uid: "uid-web" }],
      uid: "uid-pod",
    });
    const result = auditManagedDeploymentMutations({
      after,
      before,
      fieldManager: "sealai-test",
      instanceName: "instance-1",
      projectId: "project-1",
      report: report([]),
    });

    expect(result.ok).toBe(true);
  });

  it("rejects a child with a forged owner UID", () => {
    const before = inventory("a".repeat(64));
    const after = inventory("a".repeat(64));
    after.items.push({
      apiVersion: "v1",
      digest: "b".repeat(64),
      generation: null,
      kind: "Pod",
      labels: {},
      managers: ["kube-controller-manager"],
      name: "forged-child",
      namespace: "ns-1",
      ownerReferences: [
        { kind: "Deployment", name: "web", uid: "forged-owner-uid" },
      ],
      uid: "uid-forged-child",
    });

    const result = auditManagedDeploymentMutations({
      after,
      before,
      fieldManager: "sealai-test",
      instanceName: "instance-1",
      projectId: "project-1",
      report: report([]),
    });

    expect(result.ok).toBe(false);
    expect(result.violations).toContain(
      "undeclared mutation: v1|Pod|ns-1|forged-child"
    );
  });

  it("derives the final verification scope from Brain inventory", () => {
    expect(
      managedIdentityResourceRefs({
        instanceName: "instance-1",
        inventory: inventory("a".repeat(64)),
        projectId: "project-1",
      })
    ).toEqual([
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        name: "web",
        namespace: "ns-1",
        uid: "uid-web",
      },
    ]);
  });
});
