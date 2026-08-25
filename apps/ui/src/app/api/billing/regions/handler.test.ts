import assert from "node:assert/strict";
import { test } from "node:test";

import {
  INVALID_REGIONS_PAYLOAD_MESSAGE,
  MISSING_LOCAL_REGION_DOMAIN_MESSAGE,
  resolveCurrentRegionPayload,
  unknownLocalRegionDomainMessage,
  withCurrentRegion,
} from "./handler";

const CATALOG = {
  regions: [
    { domain: "gzg.example.test", name: { en: "Guangzhou" }, uid: "r-gzg" },
    { domain: "usw.example.test", name: { en: "US West" }, uid: "r-usw" },
  ],
};

test("marks the declared region as current regardless of catalog order", () => {
  const resolved = resolveCurrentRegionPayload(CATALOG, "usw.example.test");
  assert.deepEqual(resolved.payload, {
    current: CATALOG.regions[1],
    regions: CATALOG.regions,
  });
});

test("matches the declared domain case-insensitively and trimmed", () => {
  const resolved = resolveCurrentRegionPayload(CATALOG, "  USW.Example.Test ");
  assert.deepEqual(
    (resolved.payload as { current: { uid: string } }).current.uid,
    "r-usw"
  );
});

test("keeps upstream fields the schema does not know about", () => {
  const resolved = resolveCurrentRegionPayload(
    {
      regions: [
        { accountSvc: "svc.local:2333", domain: "usw.example.test", uid: "r" },
      ],
    },
    "usw.example.test"
  );
  assert.deepEqual(
    (resolved.payload as { current: { accountSvc: string } }).current
      .accountSvc,
    "svc.local:2333"
  );
});

test("a missing declaration is a hard failure, not a fallback to index 0", () => {
  assert.equal(
    resolveCurrentRegionPayload(CATALOG, "").error,
    MISSING_LOCAL_REGION_DOMAIN_MESSAGE
  );
  assert.equal(
    resolveCurrentRegionPayload(CATALOG, "   ").error,
    MISSING_LOCAL_REGION_DOMAIN_MESSAGE
  );
});

test("a declared domain absent from the catalog is a hard failure", () => {
  assert.equal(
    resolveCurrentRegionPayload(CATALOG, "other.example.test").error,
    unknownLocalRegionDomainMessage("other.example.test")
  );
});

test("an unreadable catalog is a hard failure", () => {
  assert.equal(
    resolveCurrentRegionPayload(null, "usw.example.test").error,
    INVALID_REGIONS_PAYLOAD_MESSAGE
  );
  assert.equal(
    resolveCurrentRegionPayload({ regions: "nope" }, "usw.example.test").error,
    INVALID_REGIONS_PAYLOAD_MESSAGE
  );
});

test("withCurrentRegion marks successful proxy responses", async () => {
  const handler = withCurrentRegion(
    () => Promise.resolve(Response.json(CATALOG)),
    () => "gzg.example.test"
  );
  const response = await handler(new Request("http://localhost"));
  assert.equal(response.status, 200);
  const payload = (await response.json()) as { current: { uid: string } };
  assert.equal(payload.current.uid, "r-gzg");
});

test("withCurrentRegion turns resolution failures into a 500", async () => {
  const handler = withCurrentRegion(
    () => Promise.resolve(Response.json(CATALOG)),
    () => ""
  );
  const response = await handler(new Request("http://localhost"));
  assert.equal(response.status, 500);
  const payload = (await response.json()) as { error: string };
  assert.equal(payload.error, MISSING_LOCAL_REGION_DOMAIN_MESSAGE);
});

test("withCurrentRegion passes upstream failures through untouched", async () => {
  const upstream = Response.json({ error: "denied" }, { status: 403 });
  const handler = withCurrentRegion(
    () => Promise.resolve(upstream),
    () => "usw.example.test"
  );
  const response = await handler(new Request("http://localhost"));
  assert.equal(response, upstream);
});
