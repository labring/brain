/**
 * The contract nobody used to assert: `set` then `load` must round-trip
 * through a real `document.cookie`. The original implementation read the
 * cookie through a constructed `Request`, whose `Cookie` header a browser
 * silently drops (forbidden request header) — `load` returned null forever
 * and every panel control froze. Node and happy-dom don't enforce the
 * forbidden-header list, so only a direct document.cookie read is testable
 * honestly; these tests pin that path.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

import { defineDevMockCookie } from "./cookie";
import { createDevMockCookieSource } from "./source";

const cookie = defineDevMockCookie({
  defaultScenario: "active",
  name: "sealai-source-test-dev-mock",
  scenarios: ["active", "free", "debt"] as const,
});

beforeAll(() => {
  GlobalRegistrator.register({ url: "https://dev-mock.test" });
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

function clearTestCookies() {
  for (const pair of document.cookie.split(";")) {
    const name = pair.split("=")[0]?.trim();
    if (name) {
      // biome-ignore lint/suspicious/noDocumentCookie: the subject under test is the raw document.cookie protocol.
      document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    }
  }
}

describe("createDevMockCookieSource", () => {
  test("set then load round-trips the on state", () => {
    clearTestCookies();
    const source = createDevMockCookieSource(cookie);
    source.set({ enabled: true, scenario: "debt" });
    expect(source.load()).toEqual({ enabled: true, scenario: "debt" });
  });

  test("set then load round-trips the off state with its kept scenario", () => {
    clearTestCookies();
    const source = createDevMockCookieSource(cookie);
    source.set({ enabled: false, scenario: "free" });
    expect(source.load()).toEqual({ enabled: false, scenario: "free" });
  });

  test("load finds the cookie among unrelated cookies", () => {
    clearTestCookies();
    // biome-ignore lint/suspicious/noDocumentCookie: the subject under test is the raw document.cookie protocol.
    document.cookie = "unrelated=noise; path=/";
    // biome-ignore lint/suspicious/noDocumentCookie: the subject under test is the raw document.cookie protocol.
    document.cookie = "another=one; path=/";
    const source = createDevMockCookieSource(cookie);
    source.set({ enabled: true, scenario: "active" });
    expect(source.load()).toEqual({ enabled: true, scenario: "active" });
  });

  test("load reports null while the cookie is unset or invalid", () => {
    clearTestCookies();
    const source = createDevMockCookieSource(cookie);
    expect(source.load()).toBeNull();
    // biome-ignore lint/suspicious/noDocumentCookie: the subject under test is the raw document.cookie protocol.
    document.cookie = `${cookie.name}=renamed-scenario; path=/`;
    expect(source.load()).toBeNull();
  });

  test("set clamps an unknown scenario to the default instead of corrupting the cookie", () => {
    clearTestCookies();
    const source = createDevMockCookieSource(cookie);
    source.set({ enabled: true, scenario: "no-such-scenario" });
    expect(source.load()).toEqual({ enabled: true, scenario: "active" });
  });
});
