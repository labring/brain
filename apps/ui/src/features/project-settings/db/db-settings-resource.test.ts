import assert from "node:assert/strict";
import { test } from "node:test";

import { dbResourceToSettingsData } from "./db-settings-resource";

test("dbResourceToSettingsData reads Kubernetes metadata deletionTimestamp", () => {
  const data = dbResourceToSettingsData({
    metadata: {
      deletionTimestamp: "2026-07-06T10:00:00Z",
      name: "postgres",
      namespace: "ns-a",
    },
    spec: { engine: "postgresql" },
    status: { phase: "Deleting" },
  });

  assert.equal(data.states.deletionTimestamp, "2026-07-06T10:00:00Z");
});

test("dbResourceToSettingsData does not reuse generic transient timestamps", () => {
  const data = dbResourceToSettingsData({
    metadata: {
      name: "postgres",
      namespace: "ns-a",
    },
    spec: { engine: "postgresql" },
    status: {
      phase: "Deleting",
      transientSince: "2026-07-06T09:00:00Z",
    },
  });

  assert.equal(data.states.deletionTimestamp, undefined);
});
