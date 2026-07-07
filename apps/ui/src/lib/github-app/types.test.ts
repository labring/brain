import assert from "node:assert/strict";
import { test } from "node:test";
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
});
