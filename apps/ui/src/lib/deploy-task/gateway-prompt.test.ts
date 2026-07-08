import assert from "node:assert/strict";
import { test } from "node:test";

import { buildGatewayPrompt, buildGatewayRepairPrompt } from "./gateway-prompt";
import type { DeployTaskRow } from "./schema";

const PROJECT_ID = "project-uid";
const SPEC_PROJECT_ID_RE = /spec\.projectId|spec:\s*\n\s*projectId/;
const PROJECT_LINE_RE = /^Project:/m;
const PROJECT_LABEL_RE = /metadata\.labels\.brain\.io\/project-id/;
const NATIVE_KIND_RE = /Deployment, Service, Ingress, StatefulSet/;

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

test("deployment gateway prompts keep Brain project ownership out of generated specs", () => {
  for (const prompt of [
    buildGatewayPrompt(githubTask()),
    buildGatewayRepairPrompt(githubTask()),
  ]) {
    assert.doesNotMatch(prompt, SPEC_PROJECT_ID_RE);
    assert.doesNotMatch(prompt, PROJECT_LINE_RE);
    assert.doesNotMatch(prompt, new RegExp(`Project: ${PROJECT_ID}`));
    assert.match(prompt, PROJECT_LABEL_RE);
    assert.match(prompt, NATIVE_KIND_RE);
  }
});
