import assert from "node:assert/strict";
import { test } from "node:test";

import {
  marketingAttributionSnapshotSchema,
  marketingExternalLifecycleEventInputSchema,
  marketingLifecycleEventInputSchema,
} from "./types";

const baseEvent = {
  ad_user_data_consent: true,
  deployment_id: "deployment-1",
  event_id: "event-1",
  event_name: "build_started" as const,
  first_touch: null,
  gbraid: null,
  gclid: "gclid-1",
  last_touch: null,
  occurred_at: "2026-08-06T08:00:00.000Z",
  user_id: "user-1",
  wbraid: null,
  workspace_id: "workspace-1",
};

test("marketing lifecycle schema accepts activation events", () => {
  assert.equal(
    marketingLifecycleEventInputSchema.safeParse(baseEvent).success,
    true
  );
});

test("marketing lifecycle schema requires payment identity and value", () => {
  const result = marketingLifecycleEventInputSchema.safeParse({
    ...baseEvent,
    event_name: "new_subscription",
  });
  assert.equal(result.success, false);
});

test("marketing lifecycle schema preserves multiple click IDs", () => {
  const result = marketingLifecycleEventInputSchema.safeParse({
    ...baseEvent,
    wbraid: "wbraid-1",
  });
  assert.equal(result.success, true);
});

test("marketing attribution rejects click IDs after consent withdrawal", () => {
  const result = marketingAttributionSnapshotSchema.safeParse({
    ad_user_data_consent: false,
    first_touch: {
      campaign: "us-search",
      channel: "paid_search",
      click_id_type: "gclid",
      click_id_value: "gclid-1",
      content: "repo-to-url",
      landing_hostname: "sealos.io",
      landing_path: "/",
      medium: "paid",
      source: "google",
      term: "deploy repo",
      ts: "2026-08-06T08:00:00.000Z",
    },
    gbraid: null,
    gclid: "gclid-1",
    last_touch: null,
    version: 2,
    wbraid: null,
  });
  assert.equal(result.success, false);
});

test("marketing lifecycle rejects click IDs without consent", () => {
  const result = marketingLifecycleEventInputSchema.safeParse({
    ...baseEvent,
    ad_user_data_consent: false,
  });
  assert.equal(result.success, false);
});

test("external lifecycle ingest accepts trusted post-deploy and payment events", () => {
  const result = marketingExternalLifecycleEventInputSchema.safeParse({
    ...baseEvent,
    event_name: "running_24h",
  });
  assert.equal(result.success, true);
});

test("external lifecycle ingest rejects internal deployment events", () => {
  const result =
    marketingExternalLifecycleEventInputSchema.safeParse(baseEvent);
  assert.equal(result.success, false);
});
