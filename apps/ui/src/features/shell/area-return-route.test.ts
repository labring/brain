import assert from "node:assert/strict";
import { test } from "node:test";

import { createAreaReturnRoute } from "./area-return-route";

const area = createAreaReturnRoute({
  prefix: "/workspace",
  storageKey: "workspace-return-route",
});

test("an area's return route accepts an in-app route outside the area", () => {
  assert.equal(area.sanitize("/project"), "/project");
  assert.equal(
    area.sanitize("/project/abc?selected=db:main"),
    "/project/abc?selected=db:main"
  );
  // Another area's path is a fine place to return to.
  assert.equal(area.sanitize("/billing/costs"), "/billing/costs");
});

test("an area's return route never points inside the area or outside the app", () => {
  assert.equal(area.sanitize(null), "/");
  assert.equal(area.sanitize(""), "/");
  assert.equal(area.sanitize("https://evil.example"), "/");
  assert.equal(area.sanitize("//evil.example"), "/");
  assert.equal(area.sanitize("/workspace"), "/");
  assert.equal(area.sanitize("/workspace/uid-1"), "/");
});

test("without a window the return route reads home and records nothing", () => {
  assert.equal(area.read(), "/");
  assert.doesNotThrow(() => area.record());
});

test("clearing an area's return route forgets the recorded entry point", () => {
  const storage = new Map<string, string>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: { pathname: "/project/abc", search: "?tab=logs" },
      sessionStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        removeItem: (key: string) => storage.delete(key),
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    },
  });
  try {
    area.record();
    assert.equal(area.read(), "/project/abc?tab=logs");
    area.clear();
    assert.equal(area.read(), "/");
    assert.equal(storage.has("workspace-return-route"), false);
  } finally {
    if (previous === undefined) {
      Reflect.deleteProperty(globalThis, "window");
    } else {
      Object.defineProperty(globalThis, "window", previous);
    }
  }
});
