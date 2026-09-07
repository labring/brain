import assert from "node:assert/strict";
import { test } from "node:test";

import { CANVAS_DATABASE_NODE_TYPE } from "../nodes/constants";
import {
  dbsToCanvasState,
  dbToDatabaseNodeData,
} from "./ap-list-to-canvas-state";

const POSTGRESQL_ORIGINAL_ICON_RE = /postgresql-original\.svg/;

test("DB canvas node data preserves raw status backups for DB Access", () => {
  const rawBackups = [
    {
      metadata: {
        creationTimestamp: "2026-06-09T05:00:00Z",
        name: "orders-manual-20260609",
      },
      status: { phase: "Completed" },
    },
  ];

  const data = dbToDatabaseNodeData({
    metadata: { name: "orders-db", namespace: "database-system" },
    spec: { engine: "postgresql" },
    status: {
      backups: rawBackups,
      phase: "Running",
    },
  });

  assert.equal(data.backups, rawBackups);
});

test("DB canvas node data preserves backup policy for DB Access", () => {
  const backupPolicy = {
    cronExpression: "15 8 * * *",
    enabled: true,
    retentionPeriod: "7d",
  };

  const data = dbToDatabaseNodeData({
    metadata: { name: "orders-db", namespace: "database-system" },
    spec: {
      backupPolicy,
      engine: "postgresql",
    },
    status: { phase: "Running" },
  });

  assert.deepEqual(data.backupPolicy, backupPolicy);
});

test("DB canvas nodes preserve desired replicas and effective resources for settings drafts", () => {
  const state = dbsToCanvasState(
    {
      items: [
        {
          metadata: {
            labels: { region: "192.168.12.53.nip.io" },
            name: "postgres",
            namespace: "default",
            uid: "db-uid",
          },
          spec: {
            engine: "postgresql",
            exposeNodePort: true,
            replicas: 3,
          },
          status: {
            effectiveResources: {
              cpuLimit: "1000m",
              cpuRequest: "500m",
              memoryLimit: "2Gi",
              memoryRequest: "1Gi",
              storageSize: "20Gi",
            },
            phase: "Running",
          },
        },
      ],
    },
    { namespaceFallback: "default" }
  );

  assert.equal(state.nodes[0]?.id, "db-postgres");
  assert.equal(state.nodes[0]?.type, CANVAS_DATABASE_NODE_TYPE);
  assert.deepEqual(
    (
      state.nodes[0]?.data as {
        desired?: Record<string, unknown>;
      }
    ).desired,
    {
      cpuLimit: "1000m",
      exposeNodePort: true,
      memoryLimit: "2Gi",
      replicas: 3,
      storageSize: "20Gi",
    }
  );
  assert.deepEqual(
    (
      state.nodes[0]?.data as {
        metadata?: { labels?: Record<string, unknown> };
      }
    ).metadata,
    {
      labels: { region: "192.168.12.53.nip.io" },
    }
  );
});

test("DB canvas nodes resolve known database engine icons", () => {
  const state = dbsToCanvasState(
    {
      items: [
        {
          metadata: {
            name: "postgres",
            namespace: "default",
          },
          spec: {
            engine: "postgres",
          },
          status: {
            phase: "Running",
          },
        },
      ],
    },
    { namespaceFallback: "default" }
  );

  const data = state.nodes[0]?.data as {
    states?: {
      displayEngine?: string;
      iconUrl?: string;
    };
  };
  assert.equal(data.states?.displayEngine, "PostgreSQL");
  assert.match(data.states?.iconUrl ?? "", POSTGRESQL_ORIGINAL_ICON_RE);
});

test("DB canvas nodes preserve stopped status tone for lifecycle actions", () => {
  const state = dbsToCanvasState(
    {
      items: [
        {
          metadata: {
            name: "mysql",
            namespace: "default",
          },
          spec: {
            engine: "mysql",
          },
          status: {
            phase: "Stopped",
          },
        },
      ],
    },
    { namespaceFallback: "default" }
  );

  const data = state.nodes[0]?.data as {
    states?: { status?: { label?: string; tone?: string } };
  };
  assert.deepEqual(data.states?.status, {
    label: "Stopped",
    tone: "stopped",
  });
});
