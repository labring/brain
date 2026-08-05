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

test("managed gateway turns use one hydration contract for every resume mode", () => {
  const resumeModes: ManagedDeployResumeMode[] = [
    "initial",
    "input-submitted",
    "repair",
    "brain-review-rejected",
  ];

  for (const resumeMode of resumeModes) {
    const prompt = buildManagedGatewayPrompt({
      resumeMode,
      task: githubTask(),
    });
    assert.ok(prompt.includes(`Resume mode: ${resumeMode}`));
    assert.ok(prompt.includes(".sealos/brain/control.json"));
    assert.ok(
      prompt.includes("existing files under /home/devbox/project/.sealos")
    );
    assert.ok(prompt.includes("SEALAI_INPUTS_PATH"));
    assert.ok(prompt.includes("allocated resource identity"));
    assert.ok(prompt.includes("Run /sealos-deploy"));
    assert.ok(prompt.includes("autonomously own every deployment operation"));
    assert.ok(prompt.includes("kubectl apply, patch, delete, exec"));
    assert.ok(prompt.includes(".sealos/brain/turn-report.json"));
    assert.ok(prompt.includes(".sealos/brain/verify-report.json"));
    assert.ok(!prompt.includes("mutations field"));
    if (resumeMode !== "initial") {
      assert.ok(prompt.includes("/sealos-deploy managed resume"));
    }
  }
});
