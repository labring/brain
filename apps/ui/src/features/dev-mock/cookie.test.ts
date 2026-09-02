import { describe, expect, test } from "bun:test";

import { defineDevMockCookie } from "./cookie";

const cookie = defineDevMockCookie({
  defaultScenario: "active",
  name: "sealai-test-dev-mock",
  scenarios: ["active", "free", "debt"] as const,
});

describe("parse", () => {
  test("round-trips the on state", () => {
    expect(
      cookie.parse(cookie.format({ enabled: true, scenario: "debt" }))
    ).toEqual({
      kind: "set",
      state: { enabled: true, scenario: "debt" },
    });
  });

  test("round-trips the off state, keeping the last selection", () => {
    expect(
      cookie.parse(cookie.format({ enabled: false, scenario: "free" }))
    ).toEqual({
      kind: "set",
      state: { enabled: false, scenario: "free" },
    });
  });

  test("an empty or missing value is unset", () => {
    expect(cookie.parse(undefined)).toEqual({ kind: "unset" });
    expect(cookie.parse("")).toEqual({ kind: "unset" });
    expect(cookie.parse("  ")).toEqual({ kind: "unset" });
  });

  test("an unknown scenario is invalid (fails loud on the server)", () => {
    expect(cookie.parse("payg-debt-final")).toEqual({
      kind: "invalid",
      raw: "payg-debt-final",
    });
  });

  test("an off value with an unknown scenario clamps to the default", () => {
    expect(cookie.parse("off:renamed-scenario")).toEqual({
      kind: "set",
      state: { enabled: false, scenario: "active" },
    });
  });
});

describe("fromCookieHeader", () => {
  test("finds the value among other cookies, document.cookie-shaped", () => {
    expect(
      cookie.fromCookieHeader("foo=bar; sealai-test-dev-mock=off:debt; baz=qux")
    ).toBe("off:debt");
  });

  test("returns undefined when the cookie is absent", () => {
    expect(cookie.fromCookieHeader("foo=bar")).toBeUndefined();
    expect(cookie.fromCookieHeader(null)).toBeUndefined();
    expect(cookie.fromCookieHeader("")).toBeUndefined();
  });

  test("a malformed percent-sequence surfaces raw instead of throwing", () => {
    expect(cookie.fromCookieHeader("sealai-test-dev-mock=%E0%A4%A")).toBe(
      "%E0%A4%A"
    );
  });
});

describe("client and server read the same grammar", () => {
  test("fromRequest agrees with fromCookieHeader", () => {
    const header = "a=1; sealai-test-dev-mock=free";
    const request = new Request("http://server.local", {
      headers: { cookie: header },
    });
    // Node's Request keeps the Cookie header (browsers drop it — which is
    // exactly why the client side must never read through a Request).
    expect(cookie.fromRequest(request)).toBe("free");
    expect(cookie.fromCookieHeader(header)).toBe("free");
  });
});
