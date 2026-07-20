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

test("dbResourceToSettingsData maps DB Connection Templates into the connections view model", () => {
  const data = dbResourceToSettingsData({
    metadata: { name: "postgres", namespace: "ns-a" },
    spec: { engine: "postgresql", exposeNodePort: true },
    status: {
      connectionStringPrivate:
        "postgresql://<username>:<password>@postgres-postgresql.ns-a.svc:5432/postgres",
      connectionStringPublic:
        "postgresql://<username>:<password>@192.168.10.189.nip.io:30432/postgres",
      phase: "Running",
    },
  });

  assert.deepEqual(data.connections, [
    {
      id: "private",
      kind: "private",
      label: "Private connection",
      value:
        "postgresql://<username>:<password>@postgres-postgresql.ns-a.svc:5432/postgres",
    },
    {
      id: "public",
      kind: "public",
      label: "Public connection",
      publicAccess: { enabled: true },
      value:
        "postgresql://<username>:<password>@192.168.10.189.nip.io:30432/postgres",
    },
  ]);
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
