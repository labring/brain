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
      setKubeconfig: (kubeconfig) => updates.push(`kubeconfig:${kubeconfig}`),
      setNamespace: (namespace) => updates.push(`namespace:${namespace}`),
    });

    assert.deepEqual(updates, ["language:zh"]);
  });

  test("falls back to English when desktop language is blank", () => {
    let language = "";

    applySealosSdkHydration({
      language: { lng: "  " },
      session: null,
      setDesktopLanguage: (value) => {
        language = value;
      },
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
      session: { kubeconfig },
      setDesktopLanguage: (language) => updates.push(`language:${language}`),
      setKubeconfig: (value) => updates.push(`kubeconfig:${value}`),
      setNamespace: (namespace) => updates.push(`namespace:${namespace}`),
    });

    assert.equal(updates.length, 2);
    assert.equal(updates[0]?.startsWith("kubeconfig:"), true);
    assert.equal(updates[1], "namespace:ns-demo");
  });
});
