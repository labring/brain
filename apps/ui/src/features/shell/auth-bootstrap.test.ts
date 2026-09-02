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
      setDesktopUserAvatar: (avatarUrl) => updates.push(`avatar:${avatarUrl}`),
      setDesktopUserId: (userId) => updates.push(`user:${userId}`),
      setDesktopUserName: (userName) => updates.push(`name:${userName}`),
      setKubeconfig: (kubeconfig) => updates.push(`kubeconfig:${kubeconfig}`),
      setNamespace: (namespace) => updates.push(`namespace:${namespace}`),
    });

    assert.deepEqual(updates, ["language:zh", "user:", "name:", "avatar:"]);
  });

  test("falls back to English when desktop language is blank", () => {
    let language = "";

    applySealosSdkHydration({
      language: { lng: "  " },
      session: null,
      setDesktopLanguage: (value) => {
        language = value;
      },
      setDesktopUserAvatar: () => undefined,
      setDesktopUserId: () => undefined,
      setDesktopUserName: () => undefined,
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
      setDesktopUserAvatar: (avatarUrl) => updates.push(`avatar:${avatarUrl}`),
      setDesktopUserId: (userId) => updates.push(`user:${userId}`),
      setDesktopUserName: (userName) => updates.push(`name:${userName}`),
      setKubeconfig: (value) => updates.push(`kubeconfig:${value}`),
      setNamespace: (namespace) => updates.push(`namespace:${namespace}`),
    });

    assert.equal(updates.length, 5);
    assert.equal(updates[0], "user:admin");
    assert.equal(updates[1], "name:");
    assert.equal(updates[2], "avatar:");
    assert.equal(updates[3]?.startsWith("kubeconfig:"), true);
    assert.equal(updates[4], "namespace:ns-demo");
  });

  test("captures the session user's name and avatar for the account section", () => {
    const updates: string[] = [];

    applySealosSdkHydration({
      language: null,
      session: {
        kubeconfig: "apiVersion: v1",
        user: {
          avatar: " https://desktop.test/avatar.png ",
          id: "usr-1",
          name: " Ada ",
        },
      },
      setDesktopLanguage: () => undefined,
      setDesktopUserAvatar: (avatarUrl) => updates.push(`avatar:${avatarUrl}`),
      setDesktopUserId: (userId) => updates.push(`user:${userId}`),
      setDesktopUserName: (userName) => updates.push(`name:${userName}`),
      setKubeconfig: () => undefined,
      setNamespace: () => undefined,
    });

    assert.deepEqual(updates, [
      "user:usr-1",
      "name:Ada",
      "avatar:https://desktop.test/avatar.png",
    ]);
  });

  test("clears identity fields when the session carries no user", () => {
    const updates: string[] = [];

    applySealosSdkHydration({
      language: null,
      session: { kubeconfig: "apiVersion: v1" },
      setDesktopLanguage: () => undefined,
      setDesktopUserAvatar: (avatarUrl) => updates.push(`avatar:${avatarUrl}`),
      setDesktopUserId: (userId) => updates.push(`user:${userId}`),
      setDesktopUserName: (userName) => updates.push(`name:${userName}`),
      setKubeconfig: () => undefined,
      setNamespace: () => undefined,
    });

    assert.deepEqual(updates, ["user:", "name:", "avatar:"]);
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
      setDesktopUserAvatar: () => undefined,
      setDesktopUserId: () => undefined,
      setDesktopUserName: () => undefined,
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
      setDesktopUserAvatar: () => undefined,
      setDesktopUserId: () => undefined,
      setDesktopUserName: () => undefined,
      setKubeconfig: () => undefined,
      setNamespace: () => undefined,
    });

    assert.deepEqual(updates, []);
  });
});
