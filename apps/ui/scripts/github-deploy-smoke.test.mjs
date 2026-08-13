import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGithubDeploySmokeFlow,
  normalizedLocalBaseUrl,
  parseFlowResult,
  parseGithubDeploySmokeArgs,
} from "./github-deploy-smoke.mjs";

const DEPLOYMENT_PANE_RE = /github-deployment-pane/;
const FUNCTION_EXPRESSION_RE = /^async page => \{/;
const LOCALHOST_ONLY_RE = /must be an http:\/\/localhost/;
const MODULE_SYNTAX_RE = /\b(?:import|require)\s*\(?/;
const PROJECT_REQUIRED_RE = /--project-id is required/;
const REPO_REQUIRED_RE = /--repo is required/;
const TIMELINE_RE = /deployment-task-timeline/;

test("GitHub deploy smoke defaults to localhost inspect mode", () => {
  const options = parseGithubDeploySmokeArgs([
    "--project-id",
    "project-one",
    "--repo",
    "https://github.com/labring/brain.git",
  ]);

  assert.equal(options.baseUrl, "http://localhost:3000");
  assert.equal(options.repoUrl, "https://github.com/labring/brain");
  assert.equal(options.submit, false);
});

test("GitHub deploy smoke enables mutation only through --submit", () => {
  const options = parseGithubDeploySmokeArgs([
    "--project-id",
    "project-one",
    "--repo",
    "https://github.com/labring/brain",
    "--submit",
  ]);

  assert.equal(options.submit, true);
});

test("GitHub deploy smoke rejects non-local Brain URLs", () => {
  assert.throws(
    () => normalizedLocalBaseUrl("https://brain.example.com"),
    LOCALHOST_ONLY_RE
  );
  assert.throws(
    () => normalizedLocalBaseUrl("http://192.168.1.2:3000"),
    LOCALHOST_ONLY_RE
  );
});

test("GitHub deploy smoke requires project and repository identity", () => {
  assert.throws(
    () => parseGithubDeploySmokeArgs(["--repo", "https://github.com/a/b"]),
    PROJECT_REQUIRED_RE
  );
  assert.throws(
    () => parseGithubDeploySmokeArgs(["--project-id", "project-one"]),
    REPO_REQUIRED_RE
  );
});

test("generated Playwright flow is a single function with no module syntax", () => {
  const flow = buildGithubDeploySmokeFlow({
    projectId: "project-one",
    repoUrl: "https://github.com/labring/brain",
    submit: false,
    timeoutMs: 60_000,
  });

  assert.match(flow, FUNCTION_EXPRESSION_RE);
  assert.match(flow, DEPLOYMENT_PANE_RE);
  assert.match(flow, TIMELINE_RE);
  assert.doesNotMatch(flow, MODULE_SYNTAX_RE);
  assert.equal(typeof Function(`return (${flow})`)(), "function");
});

test("flow result parser accepts Playwright CLI raw string output", () => {
  const result = parseFlowResult(
    '"BRAIN_GITHUB_DEPLOY_SMOKE_RESULT:{\\"ok\\":true,\\"code\\":\\"form_ready\\"}"\n'
  );

  assert.deepEqual(result, { code: "form_ready", ok: true });
});

test("flow result parser accepts an unquoted marker result", () => {
  const result = parseFlowResult(
    'prefix\nBRAIN_GITHUB_DEPLOY_SMOKE_RESULT:{"ok":false,"code":"failed"}\n'
  );

  assert.deepEqual(result, { code: "failed", ok: false });
});
