import assert from "node:assert/strict";
import { test } from "node:test";

import { verifyCustomDomainCname } from "./custom-domain-cname";

test("CNAME verification succeeds for exact target matches", async () => {
  const result = await verifyCustomDomainCname({
    domain: "www.example.com",
    resolveCname: async () => ["api-123.apps.example.com."],
    target: "api-123.apps.example.com",
  });

  assert.deepEqual(result, {
    domain: "www.example.com",
    ok: true,
    records: ["api-123.apps.example.com"],
    target: "api-123.apps.example.com",
  });
});

test("CNAME verification returns normalized missing and mismatch failures", async () => {
  const missing = await verifyCustomDomainCname({
    domain: "www.example.com",
    resolveCname: async () => [],
    target: "api-123.apps.example.com",
  });

  assert.deepEqual(missing, {
    domain: "www.example.com",
    message: "No CNAME record was found for www.example.com.",
    ok: false,
    reason: "missing",
    records: [],
    target: "api-123.apps.example.com",
  });

  const mismatch = await verifyCustomDomainCname({
    domain: "www.example.com",
    resolveCname: async () => ["other.apps.example.com"],
    target: "api-123.apps.example.com",
  });

  assert.deepEqual(mismatch, {
    domain: "www.example.com",
    message:
      "CNAME record for www.example.com points to other.apps.example.com, not api-123.apps.example.com.",
    ok: false,
    reason: "mismatch",
    records: ["other.apps.example.com"],
    target: "api-123.apps.example.com",
  });
});
