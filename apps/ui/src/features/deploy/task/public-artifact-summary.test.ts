import assert from "node:assert/strict";
import { test } from "node:test";

import {
  publicDeployTaskArtifactSummary,
  publicDeployTaskEventPayload,
} from "./public-artifact-summary";

const TEMPLATE_SUMMARY = {
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
    kind: "sealos-template",
    templateName: "demo",
  },
  outputJson: { templateYaml: "raw" },
  resourceYamls: ["secret: api_key"],
};

test("public artifact summary hides generated template internals", () => {
  const summary = publicDeployTaskArtifactSummary(TEMPLATE_SUMMARY);

  assert.equal(summary.deliveryManifest, undefined);
  assert.equal(summary.outputJson, undefined);
  assert.equal(summary.resourceYamls, undefined);
  assert.deepEqual(summary.deploymentPlan?.args, { mode: "demo" });
});

test("public event payload redacts nested artifact summary", () => {
  const payload = publicDeployTaskEventPayload({
    artifactSummary: TEMPLATE_SUMMARY,
    note: "applied",
  });

  assert.equal(payload.note, "applied");
  assert.deepEqual(payload.artifactSummary, {
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
