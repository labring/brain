import assert from "node:assert/strict";
import { test } from "node:test";

import {
  namespaceFromKubeconfigText,
  rewriteKubeconfigContextNamespace,
} from "./kubeconfig-namespace-core";

const KUBECONFIG = `
apiVersion: v1
kind: Config
current-context: user
contexts:
  - name: user
    context:
      cluster: sealos
      user: user
      namespace: ns-personal
clusters:
  - name: sealos
    cluster:
      server: https://apiserver.test
users:
  - name: user
    user:
      token: sa-token
`;

test("rewrites the first context's namespace like Desktop does and keeps the rest", () => {
  const rewritten = rewriteKubeconfigContextNamespace(KUBECONFIG, "ns-team");
  assert.notEqual(rewritten, null);
  assert.equal(namespaceFromKubeconfigText(rewritten ?? ""), "ns-team");
  assert.equal(rewritten?.includes("token: sa-token"), true);
  assert.equal(rewritten?.includes("server: https://apiserver.test"), true);
});

test("adds the namespace when the first context has none", () => {
  const withoutNamespace = KUBECONFIG.replace(
    "      namespace: ns-personal\n",
    ""
  );
  const rewritten = rewriteKubeconfigContextNamespace(
    withoutNamespace,
    "ns-team"
  );
  assert.equal(namespaceFromKubeconfigText(rewritten ?? ""), "ns-team");
});

test("returns null for text that is not a kubeconfig", () => {
  assert.equal(
    rewriteKubeconfigContextNamespace("- just\n- a list", "ns-x"),
    null
  );
  assert.equal(
    rewriteKubeconfigContextNamespace("apiVersion: v1", "ns-x"),
    null
  );
  assert.equal(rewriteKubeconfigContextNamespace(":::", "ns-x"), null);
});
