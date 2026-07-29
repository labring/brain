import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { applySealosSdkHydration } from "./auth-bootstrap-core";

describe("Sealos SDK bootstrap hydration", () => {
  test("applies desktop language even when session kubeconfig is empty", () => {
    const updates: string[] = [];

    applySealosSdkHydration({
      language: { lng: "zh" },
      session: { kubeconfig: "" },
      setDesktopLanguage: (language) => updates.push(`language:${language}`),
      setDesktopUserId: (userId) => updates.push(`user:${userId}`),
      setKubeconfig: (kubeconfig) => updates.push(`kubeconfig:${kubeconfig}`),
      setNamespace: (namespace) => updates.push(`namespace:${namespace}`),
    });

    assert.deepEqual(updates, ["language:zh", "user:"]);
  });

  test("falls back to English when desktop language is blank", () => {
    let language = "";

    applySealosSdkHydration({
      language: { lng: "  " },
      session: null,
      setDesktopLanguage: (value) => {
        language = value;
      },
      setDesktopUserId: () => undefined,
      setKubeconfig: () => undefined,
      setNamespace: () => undefined,
    });

    assert.equal(language, "en");
  });

  test("applies non-empty kubeconfig and derived namespace", () => {
    const updates: string[] = [];
    const kubeconfig = `
apiVersion: v1
kind: Config
current-context: demo
contexts:
  - name: demo
    context:
      cluster: demo
      user: demo
      namespace: ns-demo
`;

    applySealosSdkHydration({
      language: null,
      session: { kubeconfig, user: { id: " admin " } },
      setDesktopLanguage: (language) => updates.push(`language:${language}`),
      setDesktopUserId: (userId) => updates.push(`user:${userId}`),
      setKubeconfig: (value) => updates.push(`kubeconfig:${value}`),
      setNamespace: (namespace) => updates.push(`namespace:${namespace}`),
    });

    assert.equal(updates.length, 3);
    assert.equal(updates[0], "user:admin");
    assert.equal(updates[1]?.startsWith("kubeconfig:"), true);
    assert.equal(updates[2], "namespace:ns-demo");
  });

  test("hydrates the session app token alongside the kubeconfig", () => {
    const updates: string[] = [];

    applySealosSdkHydration({
      language: null,
      session: {
        kubeconfig: "apiVersion: v1",
        token: " session-app-token ",
        user: { id: "admin" },
      },
      setAppToken: (token) => updates.push(`appToken:${token}`),
      setDesktopLanguage: () => undefined,
      setDesktopUserId: () => undefined,
      setKubeconfig: () => undefined,
      setNamespace: () => undefined,
    });

    assert.deepEqual(updates, ["appToken:session-app-token"]);
  });

  test("a session without an app token never clears a hydrated token", () => {
    const updates: string[] = [];

    applySealosSdkHydration({
      language: null,
      session: { kubeconfig: "apiVersion: v1", user: { id: "admin" } },
      setAppToken: (token) => updates.push(`appToken:${token}`),
      setDesktopLanguage: () => undefined,
      setDesktopUserId: () => undefined,
      setKubeconfig: () => undefined,
      setNamespace: () => undefined,
    });

    assert.deepEqual(updates, []);
  });
});
