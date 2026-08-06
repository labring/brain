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
    assert.ok(
      prompt.includes("Do not add Brain identity labels or extraLabels")
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
    if (resumeMode === "initial") {
      assert.ok(prompt.includes("run /sealos-deploy"));
    }
    if (resumeMode === "input-submitted") {
      assert.ok(prompt.includes("Input revision: 1"));
    }
  }
});
