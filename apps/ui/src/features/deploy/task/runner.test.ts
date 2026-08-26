import { afterEach, describe, expect, it } from "bun:test";

import { buildRuntimeContract } from "./build-runtime-contract";
import { deployTaskFailureSummary } from "./failure-summary";
import {
  isAllowedManagedHttpUrl,
  probeManagedPublicUrl,
} from "./managed-public-probe";
import { deployOutputProgressSummary } from "./output-progress";
import {
  DEFAULT_DEPLOY_DEVBOX_STORAGE_LIMIT,
  DEFAULT_DEPLOY_SKILL_SOURCE,
  DEPLOY_DEVBOX_RUNTIME_READY_TIMEOUT_MS,
  getDeployDevboxStorageLimitFromEnv,
  getDeploySkillSourceFromEnv,
} from "./runtime-config";

describe("deploy task runner failure summaries", () => {
  it("summarizes noisy skill install failures", () => {
    expect(
      deployTaskFailureSummary(
        new Error("No valid skills found. Skills require a SKILL.md")
      )
    ).toBe(
      "Deploy skill installation failed. Redeploy; if the problem continues, contact support."
    );
  });

  it("uses a generic summary for unknown failures", () => {
    expect(deployTaskFailureSummary(new Error("very long stderr"))).toBe(
      "Deployment failed for an unknown reason. Copy the Task ID and contact support."
    );
  });
});

describe("deploy task build runtime contract", () => {
  it("derives kaniko S3 contract from DevBox network identity", () => {
    expect(
      buildRuntimeContract({
        deadlineAtMs: Date.parse("2026-07-27T00:30:00.000Z"),
        devbox: {
          creationTimestamp: null,
          deletionTimestamp: null,
          name: "sealai-deploy-demo",
          network: { uniqueID: "devbox-s3.ns-demo.svc.cluster.local" },
          state: { phase: "Running", spec: "", status: "" },
        },
        nowMs: Date.parse("2026-07-27T00:00:00.000Z"),
      })
    ).toEqual({
      accessKeyId: "admin",
      bucket: "kaniko-context",
      buildDeadlineAt: "2026-07-27T00:30:00.000Z",
      buildDeadlineSeconds: 1800,
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
        deadlineAtMs: Date.parse("2026-07-27T00:30:00.000Z"),
        devbox: {
          creationTimestamp: null,
          deletionTimestamp: null,
          name: "sealai-deploy-demo",
          state: { phase: "Running", spec: "", status: "" },
        },
        nowMs: Date.parse("2026-07-27T00:00:00.000Z"),
      })
    ).toBeNull();
  });

  it("derives kaniko S3 contract from Kubernetes DevBox status when the DevBox API omits network identity", () => {
    expect(
      buildRuntimeContract({
        deadlineAtMs: Date.parse("2026-07-27T00:10:00.000Z"),
        devbox: {
          creationTimestamp: null,
          deletionTimestamp: null,
          name: "sealai-deploy-demo",
          state: { phase: "Running", spec: "", status: "" },
        },
        networkId: "heart-law-kctz",
        nowMs: Date.parse("2026-07-27T00:00:00.000Z"),
      })
    ).toMatchObject({
      buildDeadlineAt: "2026-07-27T00:10:00.000Z",
      buildDeadlineSeconds: 600,
      devboxName: "sealai-deploy-demo",
      s3Endpoint: "http://heart-law-kctz:1319",
    });
  });
});

describe("deploy task runtime config", () => {
  it("defaults deploy Devbox storage to 10Gi", () => {
    expect(DEFAULT_DEPLOY_DEVBOX_STORAGE_LIMIT).toBe("10Gi");
    expect(getDeployDevboxStorageLimitFromEnv({})).toBe("10Gi");
    expect(
      getDeployDevboxStorageLimitFromEnv({
        DEPLOY_DEVBOX_STORAGE_LIMIT: "   ",
      })
    ).toBe("10Gi");
  });

  it("uses a configured deploy Devbox storage limit", () => {
    expect(
      getDeployDevboxStorageLimitFromEnv({
        DEPLOY_DEVBOX_STORAGE_LIMIT: " 20Gi ",
      })
    ).toBe("20Gi");
  });

  it("waits up to five minutes for deploy DevBox runtime readiness", () => {
    expect(DEPLOY_DEVBOX_RUNTIME_READY_TIMEOUT_MS).toBe(5 * 60_000);
  });

  it("defaults the deploy skill source to the unified Brain deployment branch", () => {
    expect(DEFAULT_DEPLOY_SKILL_SOURCE).toBe(
      "https://github.com/labring/sealos-skills.git#codex/unify-main-brain-deploy"
    );
    expect(getDeploySkillSourceFromEnv({})).toBe(DEFAULT_DEPLOY_SKILL_SOURCE);
    expect(
      getDeploySkillSourceFromEnv({
        DEPLOY_SKILL_SOURCE: "   ",
      })
    ).toBe(DEFAULT_DEPLOY_SKILL_SOURCE);
  });

  it("uses a configured deploy skill source", () => {
    expect(
      getDeploySkillSourceFromEnv({
        DEPLOY_SKILL_SOURCE:
          " https://github.com/labring/sealos-skills/tree/brain-deploy-preview ",
      })
    ).toBe(
      "https://github.com/labring/sealos-skills/tree/brain-deploy-preview"
    );
  });

  it("uses the configured branch source", () => {
    expect(
      getDeploySkillSourceFromEnv({
        DEPLOY_SKILL_SOURCE:
          "https://github.com/labring/sealos-skills.git#main",
      })
    ).toBe("https://github.com/labring/sealos-skills.git#main");
  });
});

describe("deploy task output progress summary", () => {
  it("does not summarize missing output files", () => {
    expect(deployOutputProgressSummary(null)).toBeNull();
    expect(deployOutputProgressSummary({})).toBeNull();
  });

  it("summarizes partial output using only file-presence booleans", () => {
    expect(
      deployOutputProgressSummary({
        buildResult: {
          detail: "Bearer private-detail-token",
          image: {
            digest: "sha256:abc",
            image_ref: "ghcr.io/zjy365/codex-recall:private-build-token",
          },
          kubernetes: {
            job: "kaniko-build",
            namespace: "ns-demo",
            pod: "kaniko-build-pod",
          },
          status: "succeeded",
        },
      })
    ).toEqual({
      complete: false,
      files: {
        buildResult: true,
        deliveryManifest: false,
        template: false,
      },
    });
  });

  it("marks output complete when all required files are available", () => {
    expect(
      deployOutputProgressSummary({
        buildResult: { status: "succeeded" },
        deliveryManifest: { artifacts: [] },
        templateYaml: "apiVersion: app.sealos.io/v1\nkind: Template\n",
      })
    ).toEqual({
      complete: true,
      files: {
        buildResult: true,
        deliveryManifest: true,
        template: true,
      },
    });
  });
});

describe("managed public URL probe", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("restricts probe targets to the tenant-owned domain", () => {
    expect(
      isAllowedManagedHttpUrl(
        new URL("https://demo.tenant-a.sealos.io"),
        "tenant-a.sealos.io"
      )
    ).toBe(true);
    expect(
      isAllowedManagedHttpUrl(
        new URL("https://tenant-a.sealos.io"),
        "tenant-a.sealos.io"
      )
    ).toBe(true);
    expect(
      isAllowedManagedHttpUrl(
        new URL("https://internal.example"),
        "tenant-a.sealos.io"
      )
    ).toBe(false);
    expect(
      isAllowedManagedHttpUrl(new URL("http://10.0.0.1"), "tenant-a.sealos.io")
    ).toBe(false);
  });

  it("accepts a 2xx response with a non-empty body", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response("ok", {
          status: 200,
        })
      )) as unknown as typeof fetch;

    await expect(
      probeManagedPublicUrl({
        allowedDomain: "tenant-a.sealos.io",
        deadlineAtMs: Date.now() + 30_000,
        publicUrl: "https://demo.tenant-a.sealos.io",
      })
    ).resolves.toBeUndefined();
  });

  it("rejects a non-2xx response", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response("oops", {
          status: 503,
        })
      )) as unknown as typeof fetch;

    await expect(
      probeManagedPublicUrl({
        allowedDomain: "tenant-a.sealos.io",
        deadlineAtMs: Date.now() + 30_000,
        publicUrl: "https://demo.tenant-a.sealos.io",
      })
    ).rejects.toThrow("returned 503");
  });

  it("rejects a target outside the tenant domain", async () => {
    await expect(
      probeManagedPublicUrl({
        allowedDomain: "tenant-a.sealos.io",
        deadlineAtMs: Date.now() + 30_000,
        publicUrl: "https://internal.example/",
      })
    ).rejects.toThrow("outside the tenant domain");
  });
});
