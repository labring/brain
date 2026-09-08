import assert from "node:assert/strict";
import { test } from "node:test";
import { githubDeployProjectPath } from "../github-deploy-link";
import {
  parseInstallNamespaceParam,
  parseInstallReturnPathParam,
} from "./types";

test("parseInstallNamespaceParam accepts valid Kubernetes namespace names", () => {
  assert.equal(parseInstallNamespaceParam("ns-c9x2uti1"), "ns-c9x2uti1");
  assert.equal(parseInstallNamespaceParam("default"), "default");
  assert.equal(parseInstallNamespaceParam("demo-1"), "demo-1");
});

test("parseInstallNamespaceParam rejects invalid namespace values", () => {
  assert.equal(parseInstallNamespaceParam(""), null);
  assert.equal(parseInstallNamespaceParam("Default"), null);
  assert.equal(parseInstallNamespaceParam("-default"), null);
  assert.equal(parseInstallNamespaceParam("default-"), null);
  assert.equal(parseInstallNamespaceParam("default/other"), null);
  assert.equal(parseInstallNamespaceParam("a".repeat(64)), null);
});

test("parseInstallReturnPathParam rejects paths that browsers may treat as external", () => {
  assert.equal(parseInstallReturnPathParam("/projects"), "/projects");
  assert.equal(parseInstallReturnPathParam("/%5Cevil.example"), null);
  assert.equal(parseInstallReturnPathParam("/\\evil.example"), null);
  for (const path of [
    "https://evil.example",
    "//evil.example",
    "/%2Fevil.example",
    "/\t/evil.example",
    "/%0a/evil.example",
  ]) {
    assert.equal(parseInstallReturnPathParam(path), null);
  }
});

test("GitHub deployment return paths survive every OAuth validation unchanged", () => {
  const path = githubDeployProjectPath("https://github.com/zjy365/aster", "1");
  let returnPath: string | null = path;
  // Session creation, callback URL construction, completion page, opener message.
  for (let step = 0; step < 4; step += 1) {
    returnPath = parseInstallReturnPathParam(returnPath);
    assert.equal(returnPath, path);
  }
});

test("return paths permit repository URLs in query values without decoding them", () => {
  const path =
    "/deploy?githubRepo=https%3A%2F%2Fgithub.com%2Fzjy365%2Faster&autoDeploy=1";
  assert.equal(parseInstallReturnPathParam(path), path);
});
