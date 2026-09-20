import assert from "node:assert/strict";
import { test } from "node:test";

import {
  readBillingReturnRoute,
  recordBillingReturnRoute,
  sanitizeBillingReturnRoute,
} from "./billing-return-route";
import { recordPendingWorkspaceCreation } from "./workspace-creation-return";

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

test("a creation's Stripe return reads as home — a pure read; the page's effect voids the entry point", () => {
  withWindow({ pathname: "/project/abc", search: "" }, (storage) => {
    recordBillingReturnRoute();
    recordPendingWorkspaceCreation("ns-new", "p1");
    assert.equal(readBillingReturnRoute(), "/project/abc");

    window.location.pathname = "/billing";
    window.location.search = "?stripeState=success&payId=p1&workspaceId=ns-new";
    assert.equal(readBillingReturnRoute(), "/");
    // Pure: deciding never mutates — the workflow's return effect clears.
    assert.equal(storage.has("billing-return-route"), true);

    // Once the return parameters are stripped, nothing creation-flavored
    // remains, but the entry point itself still stands until the effect.
    window.location.search = "";
    assert.equal(readBillingReturnRoute(), "/project/abc");
  });
});

test("a cancelled Checkout keeps the entry point: the user continues where they were", () => {
  withWindow({ pathname: "/project/abc", search: "" }, () => {
    recordBillingReturnRoute();
    recordPendingWorkspaceCreation("ns-new", "p1");
    window.location.pathname = "/billing";
    window.location.search = "?stripeState=cancel&workspaceId=ns-new";
    assert.equal(readBillingReturnRoute(), "/project/abc");
  });
});

test("a later plan change for an abandoned creation pays under its own id: it reads as a plan change", () => {
  withWindow({ pathname: "/project/abc", search: "" }, () => {
    recordBillingReturnRoute();
    // The creation's Checkout was abandoned; a plan change for that same
    // Workspace returns with its own, different pay id.
    recordPendingWorkspaceCreation("ns-new", "p-creation");
    window.location.pathname = "/billing";
    window.location.search =
      "?stripeState=success&payId=p-plan&workspaceId=ns-new";
    assert.equal(readBillingReturnRoute(), "/project/abc");
  });
});

test("a record without a pay id never reads as a creation landing: fail closed", () => {
  withWindow({ pathname: "/project/abc", search: "" }, () => {
    recordBillingReturnRoute();
    // Desktop's checkout answer carried no pay id (or a legacy record).
    recordPendingWorkspaceCreation("ns-new");
    window.location.pathname = "/billing";
    window.location.search = "?stripeState=success&payId=p1&workspaceId=ns-new";
    assert.equal(readBillingReturnRoute(), "/project/abc");
  });
});

test("a plan change's Stripe return keeps the entry point: it is the same Workspace", () => {
  withWindow({ pathname: "/project/abc", search: "" }, () => {
    recordBillingReturnRoute();
    window.location.pathname = "/billing";
    window.location.search = "?stripeState=success&payId=p1&workspaceId=ns-abc";
    assert.equal(readBillingReturnRoute(), "/project/abc");

    // Another tab's creation record names a different Workspace: kept too.
    recordPendingWorkspaceCreation("ns-other");
    assert.equal(readBillingReturnRoute(), "/project/abc");
  });
});
