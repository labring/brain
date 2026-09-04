import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildManagedGatewayPrompt,
  type ManagedDeployResumeMode,
} from "./gateway-prompt";
import type { DeployTaskRow } from "./schema";

const PROJECT_ID = "project-uid";

function githubTask(): DeployTaskRow {
  return {
    agentInputRevision: 0,
    agentProtocol: "mcp-v1",
    namespace: "tenant-a",
    projectName: PROJECT_ID,
    prompt: "Deploy example/web into a new Project",
    source: {
      kind: "github",
      repo: {
        fullName: "example/web",
        name: "web",
        url: "https://github.com/example/web",
      },
    },
  } as DeployTaskRow;
}

test("managed gateway turns use the MCP control contract for every resume mode", () => {
  const resumeModes: ManagedDeployResumeMode[] = [
    "initial",
    "input-submitted",
    "repair",
    "completion-required",
  ];

  for (const resumeMode of resumeModes) {
    const prompt = buildManagedGatewayPrompt({
      resumeMode,
      task: githubTask(),
    });
    assert.ok(prompt.includes(`Resume mode: ${resumeMode}`));
    assert.ok(prompt.includes("template_ready"));
    assert.ok(prompt.includes("deployment_completed"));
    assert.ok(prompt.includes("SEALAI_INPUTS_PATH"));
    assert.ok(prompt.includes("sole execution owner"));
    assert.ok(prompt.includes("kubectl apply"));
    assert.ok(prompt.includes("actual workload resource references"));
    assert.ok(prompt.includes("SEALAI_DEPLOY_LABELS_PATH"));
    assert.ok(!prompt.includes("SEALAI_DEPLOY_LABELS_JSON"));
    assert.ok(prompt.includes("SEALOS_REGION"));
    assert.ok(prompt.includes("SEALAI_TEMPLATE_API_URL"));
    assert.ok(prompt.includes("$KUBECONFIG"));
    assert.ok(
      prompt.includes(
        "/home/devbox/project/.agents/skills/sealos-deploy/SKILL.md"
      )
    );
    assert.ok(prompt.includes("pass them to the Template API as extraLabels"));
    assert.ok(
      prompt.includes(
        "Do not fabricate deployment-name or template-name labels"
      )
    );
    assert.ok(!prompt.includes("SEALAI_DEPLOY_INSTANCE_NAME"));
    assert.ok(!prompt.includes(".sealos/brain/control.json"));
    assert.ok(!prompt.includes(".sealos/brain/turn-report.json"));
    assert.ok(!prompt.includes(".sealos/brain/verify-report.json"));
    assert.ok(
      prompt.includes("Do not create control.json, inputs-required.json")
    );
    if (resumeMode !== "initial") {
      assert.ok(
        prompt.includes("Resume from the existing workspace and Thread")
      );
    }
    if (resumeMode === "completion-required") {
      assert.ok(
        prompt.includes(
          "previous turn ended without a Brain control notification"
        )
      );
      assert.ok(prompt.includes("do not restart source analysis"));
    }
    if (resumeMode === "initial") {
      assert.ok(prompt.includes("run /sealos-deploy"));
    }
    if (resumeMode === "input-submitted") {
      assert.ok(prompt.includes("Input revision: 1"));
    }
  }
});

test("managed repair converges the original deployment in place", () => {
  const repairPrompt = buildManagedGatewayPrompt({
    resumeMode: "repair",
    task: githubTask(),
  });
  assert.ok(repairPrompt.includes("in-place repair"));
  assert.ok(repairPrompt.includes("identify the original Instance"));
  assert.ok(repairPrompt.includes("reuse it only through the deploy helper"));
  assert.ok(
    repairPrompt.includes("do not ask for or invent replacement values")
  );
  assert.ok(repairPrompt.includes("Do not call the raw Template API"));
  assert.ok(repairPrompt.includes("restart the fresh DEPLOY pipeline"));
  assert.ok(repairPrompt.includes("fail this task rather than create"));

  for (const resumeMode of ["initial", "input-submitted"] as const) {
    const prompt = buildManagedGatewayPrompt({
      resumeMode,
      task: githubTask(),
    });
    assert.ok(!prompt.includes("in-place repair"));
  }
});
