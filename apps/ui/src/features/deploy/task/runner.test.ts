import { describe, expect, it } from "bun:test";

import { buildRuntimeContract } from "./build-runtime-contract";
import { deployTaskFailureSummary } from "./failure-summary";
import { deployOutputProgressSummary } from "./output-progress";
import {
  AGENT_DEPLOY_SKILL_SOURCE,
  DEFAULT_AI_DEPLOY_EXECUTION_MODE,
  DEFAULT_DEPLOY_DEVBOX_STORAGE_LIMIT,
  DEFAULT_DEPLOY_SKILL_SOURCE,
  DEPLOY_DEVBOX_RUNTIME_READY_TIMEOUT_MS,
  getAiDeployExecutionModeFromEnv,
  getDeployDevboxStorageLimitFromEnv,
  getDeploySkillRevisionFromEnv,
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

  it("defaults the deploy skill source to the brain-deploy branch", () => {
    expect(DEFAULT_DEPLOY_SKILL_SOURCE).toBe(
      "https://github.com/labring/sealos-skills/tree/brain-deploy"
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

  it("defaults AI deployment execution to Brain-owned apply", () => {
    expect(DEFAULT_AI_DEPLOY_EXECUTION_MODE).toBe("brain");
    expect(getAiDeployExecutionModeFromEnv({})).toBe("brain");
    expect(
      getAiDeployExecutionModeFromEnv({
        SEALAI_AI_DEPLOY_EXECUTION_MODE: "   ",
      })
    ).toBe("brain");
  });

  it("enables agent-owned deployment explicitly", () => {
    expect(
      getAiDeployExecutionModeFromEnv({
        SEALAI_AI_DEPLOY_EXECUTION_MODE: "agent",
      })
    ).toBe("agent");
  });

  it("rejects an unknown AI deployment execution mode", () => {
    expect(() =>
      getAiDeployExecutionModeFromEnv({
        SEALAI_AI_DEPLOY_EXECUTION_MODE: "hybrid",
      })
    ).toThrow(
      "SEALAI_AI_DEPLOY_EXECUTION_MODE must be either 'brain' or 'agent'."
    );
  });

  it("pins the code-owned Agent skill source to a full commit revision", () => {
    const revision = "0123456789abcdef0123456789abcdef01234567";
    const env = {
      DEPLOY_SKILL_REVISION: revision.toUpperCase(),
      DEPLOY_SKILL_SOURCE: "https://github.com/example/untrusted-skills",
      SEALAI_AI_DEPLOY_EXECUTION_MODE: "agent",
    };

    expect(getDeploySkillRevisionFromEnv(env)).toBe(revision);
    expect(getDeploySkillSourceFromEnv(env)).toBe(
      `https://github.com/labring/sealos-skills/tree/${revision}`
    );
  });

  it("uses a code-owned repository for agent execution", () => {
    expect(AGENT_DEPLOY_SKILL_SOURCE).toBe(
      "https://github.com/labring/sealos-skills"
    );
    expect(
      getDeploySkillSourceFromEnv({
        DEPLOY_SKILL_REVISION: "0123456789abcdef0123456789abcdef01234567",
        DEPLOY_SKILL_SOURCE: AGENT_DEPLOY_SKILL_SOURCE,
        SEALAI_AI_DEPLOY_EXECUTION_MODE: "agent",
      })
    ).toBe(
      "https://github.com/labring/sealos-skills/tree/0123456789abcdef0123456789abcdef01234567"
    );
  });

  it("keeps the legacy skill source unchanged when Agent mode is disabled", () => {
    expect(
      getDeploySkillSourceFromEnv({
        DEPLOY_SKILL_REVISION: "0123456789abcdef0123456789abcdef01234567",
        DEPLOY_SKILL_SOURCE:
          "https://github.com/labring/sealos-skills/tree/brain-deploy-preview",
        SEALAI_AI_DEPLOY_EXECUTION_MODE: "brain",
      })
    ).toBe(
      "https://github.com/labring/sealos-skills/tree/brain-deploy-preview"
    );
  });

  it("requires a full commit revision in agent execution mode", () => {
    expect(() =>
      getDeploySkillSourceFromEnv({
        DEPLOY_SKILL_SOURCE:
          "https://github.com/labring/sealos-skills/tree/main",
        SEALAI_AI_DEPLOY_EXECUTION_MODE: "agent",
      })
    ).toThrow(
      "DEPLOY_SKILL_REVISION must be a full Git commit SHA in agent execution mode."
    );
    expect(() =>
      getDeploySkillRevisionFromEnv({
        DEPLOY_SKILL_REVISION: "0123456",
      })
    ).toThrow("DEPLOY_SKILL_REVISION must be a full Git commit SHA.");
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
