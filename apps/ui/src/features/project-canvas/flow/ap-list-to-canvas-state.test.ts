import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CANVAS_DATABASE_NODE_TYPE,
  CANVAS_ENTRY_NODE_TYPE,
} from "../nodes/constants";
import {
  apLikeWorkloadKeysFromList,
  dbsToCanvasState,
  dbToDatabaseNodeData,
  publicAccessToCanvasState,
  templateNativeWorkloadsToCanvasState,
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

test("PublicAccess canvas nodes are derived from AP Network public addresses", () => {
  const state = publicAccessToCanvasState(
    {
      items: [
        {
          metadata: { name: "api", namespace: "default", uid: "ap-uid" },
          spec: {
            input: {
              network: {
                privatePort: 8080,
                platformAddresses: [{ id: "pa_abc123", port: 8080 }],
              },
            },
          },
          status: {
            network: {
              privateAddress: "http://api-service.default.svc:8080",
              privatePort: 8080,
              publicAddresses: [
                {
                  host: "api.example.com",
                  id: "pa_abc123",
                  port: 8080,
                  status: "accessible",
                  type: "platform",
                  url: "https://api.example.com/",
                },
              ],
            },
          },
        },
        {
          metadata: { name: "worker", namespace: "default", uid: "worker-uid" },
          spec: {
            input: {
              network: {
                privatePort: 9000,
              },
            },
          },
          status: {
            network: {
              privateAddress: "http://worker-service.default.svc:9000",
              privatePort: 9000,
            },
          },
        },
      ],
    },
    { namespaceFallback: "default" }
  );

  assert.equal(state.nodes.length, 1);
  assert.equal(state.nodes[0]?.id, "entry-api");
  assert.equal(state.nodes[0]?.type, CANVAS_ENTRY_NODE_TYPE);
  assert.deepEqual(state.nodes[0]?.data, {
    accessDomain: {
      label: "Access domain",
      value: "api.example.com",
    },
    resource: {
      apRef: "api",
      name: "api",
      namespace: "default",
      selectionKey: "public-access:default:api",
    },
    states: { name: "api" },
    targets: [
      {
        id: "pa_abc123",
        label: "Platform Address",
        status: { label: "Accessible", tone: "accessible" },
        value: "https://api.example.com/",
      },
    ],
  });
});

test("PublicAccess canvas nodes display AP-projected Custom Domain rows", () => {
  const state = publicAccessToCanvasState(
    {
      items: [
        {
          metadata: { name: "api", namespace: "default", uid: "ap-uid" },
          spec: {
            input: {
              network: {
                customDomains: [
                  {
                    domain: "www.example.com",
                    id: "cd_def456",
                    platformAddressId: "pa_abc123",
                  },
                ],
                privatePort: 8080,
                platformAddresses: [{ id: "pa_abc123", port: 8080 }],
              },
            },
          },
          status: {
            network: {
              privateAddress: "http://api-service.default.svc:8080",
              privatePort: 8080,
              publicAddresses: [
                {
                  cnameTarget: "api.example.com",
                  host: "www.example.com",
                  id: "cd_def456",
                  platformAddressId: "pa_abc123",
                  port: 8080,
                  status: "verifying",
                  type: "custom",
                  url: "https://www.example.com/",
                },
              ],
            },
          },
        },
      ],
    },
    { namespaceFallback: "default" }
  );

  assert.deepEqual(state.nodes[0]?.data, {
    accessDomain: {
      label: "Access domain",
      value: "www.example.com",
    },
    resource: {
      apRef: "api",
      name: "api",
      namespace: "default",
      selectionKey: "public-access:default:api",
    },
    states: { name: "api" },
    targets: [
      {
        id: "cd_def456",
        label: "Custom Domain",
        status: { label: "Verifying", tone: "verifying" },
        value: "https://www.example.com/",
      },
    ],
  });
});

test("PublicAccess canvas nodes fall back to desired Platform Addresses while observed URLs are pending", () => {
  const state = publicAccessToCanvasState(
    {
      items: [
        {
          metadata: { name: "api", namespace: "default" },
          spec: {
            input: {
              network: {
                privatePort: 8080,
                platformAddresses: [{ id: "pa_abc123", port: 8080 }],
              },
            },
          },
          status: {
            network: {
              privateAddress: "http://api-service.default.svc:8080",
              privatePort: 8080,
            },
          },
        },
      ],
    },
    { namespaceFallback: "default" }
  );

  assert.deepEqual(state.nodes[0]?.data, {
    accessDomain: {
      label: "Access domain",
      value: "Pending",
    },
    resource: {
      apRef: "api",
      name: "api",
      namespace: "default",
      selectionKey: "public-access:default:api",
    },
    states: { name: "api" },
    targets: [
      {
        id: "pa_abc123",
        label: "Platform Address",
        status: { label: "Progressing", tone: "progressing" },
        value: "Pending",
      },
    ],
  });
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

test("Template native workloads map Brain template Deployment and StatefulSet resources", () => {
  const state = templateNativeWorkloadsToCanvasState(
    {
      statefulSets: {
        items: [
          {
            apiVersion: "apps/v1",
            kind: "StatefulSet",
            metadata: {
              labels: {
                "brain.io/resource-kind": "template",
              },
              name: "memos",
              namespace: "ns-admin",
              uid: "sts-uid",
            },
            spec: {
              replicas: 1,
              template: {
                spec: {
                  containers: [
                    {
                      image: "ghcr.io/usememos/memos:latest",
                      name: "main",
                    },
                  ],
                },
              },
            },
            status: {
              readyReplicas: 1,
              replicas: 1,
            },
          },
        ],
      },
    },
    { namespaceFallback: "ns-admin" }
  );

  assert.equal(state.nodes.length, 1);
  assert.equal(state.nodes[0]?.id, "template-memos");
  assert.deepEqual(state.nodes[0]?.data, {
    resourceKind: "template",
    states: {
      image: "ghcr.io/usememos/memos:latest",
      kind: "StatefulSet",
      name: "memos",
      namespace: "ns-admin",
      replicas: 1,
      status: {
        label: "Running",
        tone: "running",
      },
      uid: "sts-uid",
    },
  });
});

test("Template native workloads omit items already represented by AP-like list", () => {
  const apLikeWorkloadKeys = apLikeWorkloadKeysFromList(
    {
      items: [
        {
          apiVersion: "brain.io/direct",
          kind: "AP",
          metadata: {
            name: "affine",
            namespace: "ns-admin",
          },
        },
      ],
    },
    { namespaceFallback: "ns-admin" }
  );
  const state = templateNativeWorkloadsToCanvasState(
    {
      statefulSets: {
        items: [
          {
            apiVersion: "apps/v1",
            kind: "StatefulSet",
            metadata: {
              labels: {
                "brain.io/resource-kind": "template",
              },
              name: "affine",
              namespace: "ns-admin",
              uid: "sts-uid",
            },
            spec: {
              template: {
                spec: {
                  containers: [{ image: "affine:stable", name: "main" }],
                },
              },
            },
          },
        ],
      },
    },
    {
      apLikeWorkloadKeys,
      namespaceFallback: "ns-admin",
    }
  );

  assert.deepEqual(state.nodes, []);
});

test("Template native workloads ignore direct AP controller Deployments", () => {
  const state = templateNativeWorkloadsToCanvasState(
    {
      deployments: {
        items: [
          {
            apiVersion: "apps/v1",
            kind: "Deployment",
            metadata: {
              labels: {
                "brain.io/project-id": "project-uid",
              },
              name: "ap-xaqwfd",
              namespace: "ns-admin",
              uid: "deploy-uid",
            },
            spec: {
              replicas: 1,
              template: {
                spec: {
                  containers: [{ image: "nginx", name: "main" }],
                },
              },
            },
            status: {
              readyReplicas: 1,
              replicas: 1,
            },
          },
        ],
      },
    },
    { namespaceFallback: "ns-admin" }
  );

  assert.deepEqual(state.nodes, []);
});
