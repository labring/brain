import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CANVAS_DATABASE_NODE_TYPE,
  CANVAS_ENTRY_NODE_TYPE,
} from "../nodes/constants";
import {
  dbsToCanvasState,
  entryPointsToCanvasState,
} from "./ap-list-to-canvas-state";

test("EntryPoint canvas nodes are derived from AP Network public addresses", () => {
  const state = entryPointsToCanvasState(undefined, {
    apsData: {
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
    namespaceFallback: "default",
  });

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
      selectionKey: "entry:default:api",
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

test("EntryPoint canvas nodes display AP-projected Custom Domain rows", () => {
  const state = entryPointsToCanvasState(undefined, {
    apsData: {
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
                  status: "pending",
                  type: "custom",
                  url: "https://www.example.com/",
                },
              ],
            },
          },
        },
      ],
    },
    namespaceFallback: "default",
  });

  assert.deepEqual(state.nodes[0]?.data, {
    accessDomain: {
      label: "Access domain",
      value: "www.example.com",
    },
    resource: {
      apRef: "api",
      name: "api",
      namespace: "default",
      selectionKey: "entry:default:api",
    },
    states: { name: "api" },
    targets: [
      {
        id: "cd_def456",
        label: "Custom Domain",
        status: { label: "Pending", tone: "pending" },
        value: "https://www.example.com/",
      },
    ],
  });
});

test("EntryPoint canvas nodes fall back to desired Platform Addresses while observed URLs are pending", () => {
  const state = entryPointsToCanvasState(undefined, {
    apsData: {
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
    namespaceFallback: "default",
  });

  assert.deepEqual(state.nodes[0]?.data, {
    accessDomain: {
      label: "Access domain",
      value: "Pending",
    },
    resource: {
      apRef: "api",
      name: "api",
      namespace: "default",
      selectionKey: "entry:default:api",
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

test("EntryPoint canvas nodes keep uid fallback when resource name is unavailable", () => {
  const state = entryPointsToCanvasState(
    {
      items: [
        {
          metadata: { namespace: "default", uid: "entry-uid" },
          spec: {
            apRef: "api",
            targets: [
              {
                id: "pa_abc123",
                platformDomain: "https://api.example.com",
                port: 8080,
                status: "accessible",
              },
            ],
          },
        },
      ],
    },
    { namespaceFallback: "default" }
  );

  assert.equal(state.nodes[0]?.id, "entry-entry-uid");
  assert.deepEqual(state.nodes[0]?.data, {
    accessDomain: {
      label: "Access domain",
      value: "api.example.com",
    },
    resource: {
      apRef: "api",
      name: "unknown",
      namespace: "default",
      selectionKey: "entry:default:api",
      uid: "entry-uid",
    },
    states: { name: "unknown" },
    targets: [
      {
        id: "pa_abc123",
        label: "Public Domain",
        status: { label: "Accessible", tone: "accessible" },
        value: "https://api.example.com/",
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
