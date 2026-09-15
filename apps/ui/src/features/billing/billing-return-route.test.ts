import assert from "node:assert/strict";
import { test } from "node:test";

import {
  readBillingReturnRoute,
  recordBillingReturnRoute,
  sanitizeBillingReturnRoute,
} from "./billing-return-route";

function withWindow(
  location: { pathname: string; search: string },
  run: (storage: Map<string, string>) => void
) {
  const storage = new Map<string, string>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location,
      sessionStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        removeItem: (key: string) => storage.delete(key),
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    },
  });
  try {
    run(storage);
  } finally {
    if (previous === undefined) {
      Reflect.deleteProperty(globalThis, "window");
    } else {
      Object.defineProperty(globalThis, "window", previous);
    }
  }
}

test("sanitizeBillingReturnRoute accepts an in-app route outside /billing", () => {
  assert.equal(sanitizeBillingReturnRoute("/project"), "/project");
  assert.equal(
    sanitizeBillingReturnRoute("/project/abc?selected=db:main"),
    "/project/abc?selected=db:main"
  );
});

test("sanitizeBillingReturnRoute falls back to home for unusable values", () => {
  assert.equal(sanitizeBillingReturnRoute(null), "/");
  assert.equal(sanitizeBillingReturnRoute(""), "/");
  assert.equal(sanitizeBillingReturnRoute("https://evil.example"), "/");
  assert.equal(sanitizeBillingReturnRoute("//evil.example"), "/");
  assert.equal(sanitizeBillingReturnRoute("/billing"), "/");
  assert.equal(sanitizeBillingReturnRoute("/billing/costs"), "/");
  assert.equal(sanitizeBillingReturnRoute("/billing?mode=upgrade"), "/");
});

test("a Stripe return voids the recorded entry point: it names the old Workspace's route", () => {
  withWindow({ pathname: "/project/abc", search: "" }, (storage) => {
    recordBillingReturnRoute();
    assert.equal(readBillingReturnRoute(), "/project/abc");

    window.location.pathname = "/billing";
    window.location.search = "?stripeState=success&payId=p1&workspaceId=ns-new";
    assert.equal(readBillingReturnRoute(), "/");
    assert.equal(storage.size, 0);

    // Once the return parameters are stripped, nothing recorded remains.
    window.location.search = "";
    assert.equal(readBillingReturnRoute(), "/");
  });
});
