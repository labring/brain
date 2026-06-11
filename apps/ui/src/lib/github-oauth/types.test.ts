import assert from "node:assert/strict";
import { test } from "node:test";
import { parseOAuthNamespaceParam } from "./types";

test("parseOAuthNamespaceParam accepts valid Kubernetes namespace names", () => {
  assert.equal(parseOAuthNamespaceParam("ns-c9x2uti1"), "ns-c9x2uti1");
  assert.equal(parseOAuthNamespaceParam("default"), "default");
  assert.equal(parseOAuthNamespaceParam("demo-1"), "demo-1");
});

test("parseOAuthNamespaceParam rejects invalid namespace values", () => {
  assert.equal(parseOAuthNamespaceParam(""), null);
  assert.equal(parseOAuthNamespaceParam("Default"), null);
  assert.equal(parseOAuthNamespaceParam("-default"), null);
  assert.equal(parseOAuthNamespaceParam("default-"), null);
  assert.equal(parseOAuthNamespaceParam("default/other"), null);
  assert.equal(parseOAuthNamespaceParam("a".repeat(64)), null);
});
