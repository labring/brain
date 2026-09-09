import assert from "node:assert/strict";
import { test } from "node:test";
import { ingressEntryPath, primaryIngressPath } from "./ingress-entry-path";

test("ingressEntryPath keeps the literal head of a regex path and rejects fragments", () => {
  assert.equal(ingressEntryPath("/admin(/|$)(.*)"), "/admin");
  assert.equal(ingressEntryPath("/?(.*)"), "/");
  assert.equal(ingressEntryPath("/api/?(.*)"), "/api");
  // A literal path keeps its spelling: an Exact `/console/` is not `/console`.
  assert.equal(ingressEntryPath("/console/"), "/console/");
  assert.equal(ingressEntryPath("/console"), "/console");
  assert.equal(ingressEntryPath("/admin#x"), null);
  assert.equal(ingressEntryPath("admin"), null);
  assert.equal(ingressEntryPath(42), null);
});

test("primaryIngressPath: a declared root wins outright", () => {
  assert.equal(primaryIngressPath(["/api", "/admin", "/"]), "/");
});

test("primaryIngressPath: the page its assets extend wins over an earlier API route", () => {
  assert.equal(
    primaryIngressPath([
      "/api",
      "/admin.css",
      "/admin.js",
      "/admin-i18n.js",
      "/admin",
      "/dynmap",
    ]),
    "/admin"
  );
});

test("primaryIngressPath: a tie keeps manifest order", () => {
  assert.equal(primaryIngressPath(["/api", "/ws", "/ai"]), "/api");
  assert.equal(primaryIngressPath(["/admin", "/api"]), "/admin");
});

test("primaryIngressPath: asset-only paths keep the first asset rather than a root the port never serves", () => {
  assert.equal(primaryIngressPath(["/app.js", "/app.css"]), "/app.js");
  assert.equal(primaryIngressPath([]), "/");
});
