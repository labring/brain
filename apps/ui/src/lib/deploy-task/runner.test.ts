import { describe, expect, it } from "bun:test";

import { buildRuntimeContract } from "./build-runtime-contract";
import { deployTaskFailureSummary } from "./failure-summary";
import { DEPLOY_DEVBOX_RUNTIME_READY_TIMEOUT_MS } from "./runtime-config";

describe("deploy task runner failure summaries", () => {
  it("summarizes noisy skill install failures", () => {
    expect(
      deployTaskFailureSummary(
        new Error("No valid skills found. Skills require a SKILL.md")
      )
    ).toBe("Deploy skill installation failed.");
  });

  it("uses a generic summary for unknown failures", () => {
    expect(deployTaskFailureSummary(new Error("very long stderr"))).toBe(
      "Deployment task failed."
    );
  });
});

describe("deploy task build runtime contract", () => {
  it("derives kaniko S3 contract from DevBox network identity", () => {
    expect(
      buildRuntimeContract({
        devbox: {
          creationTimestamp: null,
          deletionTimestamp: null,
          name: "sealai-deploy-demo",
          network: { uniqueID: "devbox-s3.ns-demo.svc.cluster.local" },
          state: { phase: "Running", spec: "", status: "" },
        },
      })
    ).toEqual({
      accessKeyId: "admin",
      bucket: "kaniko-context",
      devboxName: "sealai-deploy-demo",
      region: "sealos-internal",
      s3Endpoint: "http://devbox-s3.ns-demo.svc.cluster.local:1319",
      secretKeyRef: {
        key: "SEALOS_DEVBOX_JWT_SECRET",
        name: "sealai-deploy-demo",
      },
      workspaceDir: "/home/devbox/project",
    });
  });

  it("does not create a kaniko S3 contract without DevBox network identity", () => {
    expect(
      buildRuntimeContract({
        devbox: {
          creationTimestamp: null,
          deletionTimestamp: null,
          name: "sealai-deploy-demo",
          state: { phase: "Running", spec: "", status: "" },
        },
      })
    ).toBeNull();
  });

  it("derives kaniko S3 contract from Kubernetes DevBox status when the DevBox API omits network identity", () => {
    expect(
      buildRuntimeContract({
        devbox: {
          creationTimestamp: null,
          deletionTimestamp: null,
          name: "sealai-deploy-demo",
          state: { phase: "Running", spec: "", status: "" },
        },
        networkId: "heart-law-kctz",
      })
    ).toMatchObject({
      devboxName: "sealai-deploy-demo",
      s3Endpoint: "http://heart-law-kctz:1319",
    });
  });
});

describe("deploy task runtime config", () => {
  it("waits up to one hour for deploy DevBox runtime readiness", () => {
    expect(DEPLOY_DEVBOX_RUNTIME_READY_TIMEOUT_MS).toBe(60 * 60_000);
  });
});
