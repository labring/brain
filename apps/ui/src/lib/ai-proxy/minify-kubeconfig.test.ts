import { describe, expect, it } from "bun:test";

import { minifyKubeconfigForAiProxy } from "./minify-kubeconfig";

const WITHOUT_USERS_RE = /users:[\s\S]*$/;

const MULTI_CLUSTER = `
apiVersion: v1
kind: Config
current-context: active
clusters:
  - name: active
    cluster:
      server: https://active.example:6443
      certificate-authority-data: Q0EtQ0VSVA==
  - name: other
    cluster:
      server: https://other.example:6443
      certificate-authority-data: T1RIRVItQ0E=
contexts:
  - name: active
    context:
      cluster: active
      user: active-user
      namespace: ns-demo
  - name: other
    context:
      cluster: other
      user: other-user
users:
  - name: active-user
    user:
      token: active-token
  - name: other-user
    user:
      token: other-token
`.trim();

describe("minifyKubeconfigForAiProxy", () => {
  it("keeps only the current context and shrinks the document", () => {
    const mini = minifyKubeconfigForAiProxy(MULTI_CLUSTER);

    expect(mini.length).toBeLessThan(MULTI_CLUSTER.length);
    expect(mini).toContain("active.example");
    expect(mini).toContain("active-token");
    expect(mini).toContain("ns-demo");
    expect(mini).not.toContain("other.example");
    expect(mini).not.toContain("other-token");
  });

  it("preserves current-context and its credentials", () => {
    const mini = minifyKubeconfigForAiProxy(MULTI_CLUSTER);

    expect(mini).toContain("current-context: active");
    expect(mini).toContain("cluster: active");
    expect(mini).toContain("user: active-user");
  });

  it("returns the document unchanged when the active user is missing", () => {
    const partial = MULTI_CLUSTER.replace(WITHOUT_USERS_RE, "");
    expect(minifyKubeconfigForAiProxy(partial)).toBe(partial);
  });

  it("returns the document unchanged when it cannot be parsed", () => {
    const invalid = "not: [valid";
    expect(minifyKubeconfigForAiProxy(invalid)).toBe(invalid);
  });
});
