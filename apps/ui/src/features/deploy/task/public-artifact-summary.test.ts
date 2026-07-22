import assert from "node:assert/strict";
import { test } from "node:test";

import {
  publicDeployTaskArtifactSummary,
  publicDeployTaskEventPayload,
} from "./public-artifact-summary";
import type { DeployTaskArtifactSummary } from "./schema";

const TEMPLATE_SUMMARY = {
  buildResult: {
    error: { message: "Bearer private-build-token" },
    status: "failed",
  },
  deliveryManifest: { args: { api_key: "secret", mode: "demo" } },
  deploymentPlan: {
    args: { api_key: "secret", mode: "demo" },
    inputs: [
      {
        key: "api_key",
        required: true,
        sensitive: true,
        type: "secret",
      },
      {
        key: "mode",
        required: false,
        type: "string",
      },
    ],
    kind: "sealos-template" as const,
    templateName: "demo",
  },
  outputJson: { templateYaml: "raw" },
  resourceYamls: ["secret: api_key"],
} satisfies DeployTaskArtifactSummary;

test("public artifact summary hides generated template internals", () => {
  const summary = publicDeployTaskArtifactSummary(TEMPLATE_SUMMARY);

  assert.equal(summary.deliveryManifest, undefined);
  assert.deepEqual(summary.buildResult, TEMPLATE_SUMMARY.buildResult);
  assert.equal(summary.outputJson, undefined);
  assert.equal(summary.resourceYamls, undefined);
  assert.deepEqual(summary.deploymentPlan?.args, { mode: "demo" });
});

test("public AI artifact summary hides generated build errors", () => {
  const summary = publicDeployTaskArtifactSummary(TEMPLATE_SUMMARY, {
    runner: { kind: "ai", runtimeProvider: "devbox" },
  });

  assert.equal(summary.buildResult, undefined);
  assert.equal(JSON.stringify(summary).includes("private-build-token"), false);
});

test("public event payload redacts nested artifact summary", () => {
  const payload = publicDeployTaskEventPayload({
    artifactSummary: TEMPLATE_SUMMARY,
    note: "applied",
  });

  assert.equal(payload.note, "applied");
  assert.deepEqual(payload.artifactSummary, {
    buildResult: TEMPLATE_SUMMARY.buildResult,
    deploymentPlan: {
      args: { mode: "demo" },
      inputs: [
        {
          key: "api_key",
          required: true,
          sensitive: true,
          type: "secret",
        },
        {
          key: "mode",
          required: false,
          type: "string",
        },
      ],
      kind: "sealos-template",
      templateName: "demo",
    },
  });
});

test("public AI event payload removes persisted raw errors", () => {
  const payload = publicDeployTaskEventPayload(
    {
      error: "Bearer private-token",
      reason: "gateway-upstream-error",
    },
    { runner: { kind: "ai", runtimeProvider: "devbox" } }
  );

  assert.deepEqual(payload, { reason: "gateway-upstream-error" });
});

test("public AI event payload recursively removes private diagnostic fields", () => {
  const payload = publicDeployTaskEventPayload(
    {
      data: {
        lastError: "Bearer private-token",
        nested: { stderr: "private stderr", state: "Pending" },
      },
      reason: "deploy-runtime-unavailable",
    },
    { runner: { kind: "ai", runtimeProvider: "devbox" } }
  );

  assert.deepEqual(payload, {
    data: { nested: { state: "Pending" } },
    reason: "deploy-runtime-unavailable",
  });
});

test("public AI gateway event payloads fail closed", () => {
  const payload = publicDeployTaskEventPayload(
    { arbitrary: { message: "Bearer private-token" }, state: "ready" },
    {
      eventKind: "deploy_task.gateway_state",
      runner: { kind: "ai", runtimeProvider: "devbox" },
    }
  );

  assert.deepEqual(payload, {});
});
