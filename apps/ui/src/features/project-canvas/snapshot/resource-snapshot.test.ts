import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CANVAS_CONTAINER_NODE_TYPE,
  CANVAS_DATABASE_NODE_TYPE,
  CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE,
  CANVAS_ENTRY_NODE_TYPE,
} from "@/features/project-canvas/nodes/constants";
import type { DeploymentTaskProjection } from "@/lib/deploy-task/projection";
import { DEPLOYMENT_UNKNOWN_SLOT_ID } from "../layout/placement-owner";
import type {
  CanvasLayoutDocument,
  CanvasLayoutNode,
  CanvasLayoutResourceKind,
} from "../layout/types";
import { buildProjectCanvasResourceSnapshot } from "./resource-snapshot";

function layoutResourceNode(
  kind: CanvasLayoutResourceKind,
  name: string,
  position: CanvasLayoutNode["position"]
): CanvasLayoutNode {
  return {
    owner: {
      kind: "resource",
      ref: { kind, name, namespace: "default" },
    },
    position,
  };
}

function deploymentProjectionLayoutNode(input: {
  position: CanvasLayoutNode["position"];
  slotId: string;
  taskId?: string;
}): CanvasLayoutNode {
  return {
    owner: {
      kind: "deploymentProjection",
      slotId: input.slotId,
      taskId: input.taskId ?? "task-1",
    },
    position: input.position,
  };
}

test("resource snapshot derives canvas state and AP Environment DB Reference Sources", () => {
  const snapshot = buildProjectCanvasResourceSnapshot({
    apsData: {
      items: [
        {
          metadata: { name: "api", namespace: "default", uid: "ap-uid" },
          spec: { input: { env: [] } },
          status: { phase: "Running" },
        },
      ],
    },
    dbsData: {
      items: [
        {
          metadata: { name: "postgres", namespace: "default" },
          spec: { engine: "postgres" },
          status: {
            connectionStringPrivate: "postgres://private",
            variables: [
              {
                name: "POSTGRES_HOST",
                valueFrom: {
                  secretKeyRef: { key: "host", name: "postgres-conn" },
                },
              },
            ],
          },
        },
      ],
    },
    isEmptyGraphLoading: false,
    kubeconfig: "apiVersion: v1",
    namespace: "default",
  });

  assert.deepEqual(
    snapshot.canvasState.nodes.map((node) => ({
      id: node.id,
      type: node.type,
    })),
    [
      { id: "ap-api", type: CANVAS_CONTAINER_NODE_TYPE },
      { id: "db-postgres", type: CANVAS_DATABASE_NODE_TYPE },
    ]
  );
  assert.deepEqual(snapshot.apEnvironmentDbReferenceSources, [
    {
      engine: "postgres",
      name: "postgres",
      namespace: "default",
      primitiveSecretRefs: {
        host: { key: "host", name: "postgres-conn" },
      },
      privateDsn: "postgres://private",
      variables: [
        {
          name: "POSTGRES_HOST",
          type: "secret",
          valueFrom: {
            secretKeyRef: { key: "host", name: "postgres-conn" },
          },
        },
      ],
    },
  ]);
  assert.equal(snapshot.frameState.overlay, "none");
});

test("resource snapshot emits first-placement intent before merge intent", () => {
  const layout: CanvasLayoutDocument = {
    namespace: "default",
    nodes: [],
    projectId: "project-uid",
    version: 1,
  };
  const snapshot = buildProjectCanvasResourceSnapshot({
    apsData: {
      items: [
        {
          metadata: { name: "api", namespace: "default" },
          spec: { input: {} },
          status: { phase: "Running" },
        },
      ],
    },
    canvasLayout: layout,
    isEmptyGraphLoading: false,
    kubeconfig: "apiVersion: v1",
    namespace: "default",
  });

  assert.deepEqual(snapshot.layoutIntent, {
    kind: "first-placement",
    nodes: [
      {
        expanded: false,
        owner: {
          kind: "resource",
          ref: { kind: "AP", name: "api", namespace: "default" },
        },
        position: { x: 0, y: 0 },
        source: "generated",
      },
    ],
  });
});

test("resource snapshot hides graph facts until Canvas Layout is ready", () => {
  const snapshot = buildProjectCanvasResourceSnapshot({
    apsData: {
      items: [
        {
          metadata: { name: "api", namespace: "default" },
          spec: { input: {} },
          status: { phase: "Running" },
        },
      ],
    },
    canvasLayoutReady: false,
    isEmptyGraphLoading: true,
    kubeconfig: "apiVersion: v1",
    namespace: "default",
  });

  assert.deepEqual(snapshot.canvasState.nodes, []);
  assert.deepEqual(snapshot.canvasState.edges, []);
  assert.equal(snapshot.frameState.overlay, "loading");
  assert.equal(snapshot.layoutIntent, null);
});

test("resource snapshot projects active deploy tasks as placeholder nodes", () => {
  const snapshot = buildProjectCanvasResourceSnapshot({
    deployTasks: [
      {
        artifactSummary: {},
        canvasProjection: {},
        completedAt: null,
        id: "task-1",
        namespace: "default",
        phase: "queued",
        projectId: "project-uid",
        status: "queued",
        updatedAt: "2026-06-11T10:00:00.000Z",
      },
    ],
    isEmptyGraphLoading: false,
    kubeconfig: "apiVersion: v1",
    namespace: "default",
  });

  assert.deepEqual(
    snapshot.canvasState.nodes.map((node) => ({
      id: node.id,
      type: node.type,
    })),
    [
      {
        id: "deployment-placeholder-task-1",
        type: CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE,
      },
    ]
  );
  assert.equal(snapshot.frameState.overlay, "none");
});

test("resource snapshot hands deployment slot placement to AP result", () => {
  const snapshot = buildProjectCanvasResourceSnapshot({
    apsData: {
      items: [
        {
          metadata: { name: "api", namespace: "default" },
          spec: { input: {} },
          status: { phase: "Running" },
        },
      ],
    },
    canvasLayout: {
      namespace: "default",
      nodes: [
        deploymentProjectionLayoutNode({
          position: { x: 680, y: 280 },
          slotId: "AP:default:api",
        }),
      ],
      projectId: "project-uid",
      version: 1,
    },
    deployTasks: [
      {
        artifactSummary: {
          resources: [
            {
              apiVersion: "brain.io/direct",
              kind: "AP",
              name: "api",
              namespace: "default",
            },
          ],
        },
        canvasProjection: {
          slots: [
            {
              anchor: true,
              expectedRef: {
                kind: "AP",
                name: "api",
                namespace: "default",
              },
              id: "AP:default:api",
            },
          ],
        },
        completedAt: null,
        id: "task-1",
        namespace: "default",
        phase: "apply",
        projectId: "project-uid",
        status: "applying",
        updatedAt: "2026-06-11T10:00:00.000Z",
      },
    ],
    isEmptyGraphLoading: false,
    kubeconfig: "apiVersion: v1",
    namespace: "default",
  });

  assert.deepEqual(
    snapshot.canvasState.nodes.map((node) => ({
      id: node.id,
      position: node.position,
      type: node.type,
    })),
    [
      {
        id: "ap-api",
        position: { x: 680, y: 280 },
        type: CANVAS_CONTAINER_NODE_TYPE,
      },
    ]
  );
  assert.deepEqual(snapshot.layoutIntent, {
    commands: [
      {
        fromOwner: {
          kind: "deploymentProjection",
          slotId: "AP:default:api",
          taskId: "task-1",
        },
        kind: "rekey",
        toOwner: {
          kind: "resource",
          ref: { kind: "AP", name: "api", namespace: "default" },
        },
      },
    ],
    expectedVersion: 1,
    kind: "placement-commands",
  });
});

test("resource snapshot materializes unknown deployment slot placement before AP handoff", () => {
  const snapshot = buildProjectCanvasResourceSnapshot({
    apsData: {
      items: [
        {
          metadata: { name: "api", namespace: "default" },
          spec: { input: {} },
          status: { phase: "Running" },
        },
      ],
    },
    canvasLayout: {
      namespace: "default",
      nodes: [
        deploymentProjectionLayoutNode({
          position: { x: 680, y: 280 },
          slotId: DEPLOYMENT_UNKNOWN_SLOT_ID,
        }),
      ],
      projectId: "project-uid",
      version: 1,
    },
    deployTasks: [
      {
        artifactSummary: {
          resources: [
            {
              apiVersion: "brain.io/direct",
              kind: "AP",
              name: "api",
              namespace: "default",
            },
          ],
        },
        canvasProjection: {},
        completedAt: null,
        id: "task-1",
        namespace: "default",
        phase: "apply",
        projectId: "project-uid",
        status: "applying",
        updatedAt: "2026-06-11T10:00:00.000Z",
      },
    ],
    isEmptyGraphLoading: false,
    kubeconfig: "apiVersion: v1",
    namespace: "default",
  });

  assert.deepEqual(
    snapshot.canvasState.nodes.map((node) => ({
      id: node.id,
      position: node.position,
      type: node.type,
    })),
    [
      {
        id: "ap-api",
        position: { x: 680, y: 280 },
        type: CANVAS_CONTAINER_NODE_TYPE,
      },
    ]
  );
  assert.deepEqual(snapshot.layoutIntent, {
    commands: [
      {
        fromOwner: {
          kind: "deploymentProjection",
          slotId: DEPLOYMENT_UNKNOWN_SLOT_ID,
          taskId: "task-1",
        },
        kind: "rekey",
        toOwner: {
          kind: "deploymentProjection",
          slotId: "AP:default:api",
          taskId: "task-1",
        },
      },
    ],
    expectedVersion: 1,
    kind: "placement-commands",
  });
});

test("resource snapshot refines unknown deployment placement into the full slot group", () => {
  const snapshot = buildProjectCanvasResourceSnapshot({
    canvasLayout: {
      namespace: "default",
      nodes: [
        deploymentProjectionLayoutNode({
          position: { x: 680, y: 280 },
          slotId: DEPLOYMENT_UNKNOWN_SLOT_ID,
        }),
      ],
      projectId: "project-uid",
      version: 1,
    },
    deployTasks: [
      {
        artifactSummary: {},
        canvasProjection: {
          edges: [
            {
              evidence: "ap-env-raw-source-reference",
              sourceSlotId: "AP:default:api",
              targetSlotId: "DB:default:postgres",
            },
          ],
          slots: [
            {
              anchor: true,
              expectedRef: {
                kind: "AP",
                name: "api",
                namespace: "default",
              },
              id: "AP:default:api",
            },
            {
              expectedRef: {
                kind: "DB",
                name: "postgres",
                namespace: "default",
              },
              id: "DB:default:postgres",
            },
          ],
        },
        completedAt: null,
        id: "task-1",
        namespace: "default",
        phase: "apply",
        projectId: "project-uid",
        status: "applying",
        updatedAt: "2026-06-11T10:00:00.000Z",
      },
    ],
    isEmptyGraphLoading: false,
    kubeconfig: "apiVersion: v1",
    namespace: "default",
  });

  assert.deepEqual(
    snapshot.canvasState.nodes.map((node) => ({
      id: node.id,
      position: node.position,
      type: node.type,
    })),
    [
      {
        id: "deployment-result-placeholder-task-1-AP:default:api",
        position: { x: 680, y: 280 },
        type: CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE,
      },
      {
        id: "deployment-result-placeholder-task-1-DB:default:postgres",
        position: { x: 1020, y: 280 },
        type: CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE,
      },
    ]
  );
  assert.deepEqual(snapshot.layoutIntent, {
    commands: [
      {
        fromOwner: {
          kind: "deploymentProjection",
          slotId: DEPLOYMENT_UNKNOWN_SLOT_ID,
          taskId: "task-1",
        },
        kind: "rekey",
        toOwner: {
          kind: "deploymentProjection",
          slotId: "AP:default:api",
          taskId: "task-1",
        },
      },
      {
        kind: "create",
        owner: {
          kind: "deploymentProjection",
          slotId: "DB:default:postgres",
          taskId: "task-1",
        },
        position: { x: 1020, y: 280 },
        source: "generated",
      },
    ],
    expectedVersion: 1,
    kind: "placement-commands",
  });
});

test("resource snapshot rekeys deployment slot placement to matching AP result", () => {
  const snapshot = buildProjectCanvasResourceSnapshot({
    apsData: {
      items: [
        {
          metadata: { name: "api", namespace: "default" },
          spec: { input: {} },
          status: { phase: "Running" },
        },
      ],
    },
    canvasLayout: {
      namespace: "default",
      nodes: [
        {
          owner: {
            kind: "deploymentProjection",
            slotId: "AP:default:api",
            taskId: "task-1",
          },
          position: { x: 680, y: 280 },
          source: "user",
        },
      ],
      projectId: "project-uid",
      version: 7,
    },
    deployTasks: [
      {
        artifactSummary: {},
        canvasProjection: {
          slots: [
            {
              anchor: true,
              expectedRef: {
                kind: "AP",
                name: "api",
                namespace: "default",
              },
              id: "AP:default:api",
            },
          ],
        },
        completedAt: null,
        id: "task-1",
        namespace: "default",
        phase: "apply",
        projectId: "project-uid",
        status: "applying",
        updatedAt: "2026-06-11T10:00:00.000Z",
      },
    ],
    isEmptyGraphLoading: false,
    kubeconfig: "apiVersion: v1",
    namespace: "default",
  });

  assert.deepEqual(snapshot.canvasState.nodes[0]?.position, {
    x: 680,
    y: 280,
  });
  assert.deepEqual(snapshot.layoutIntent, {
    commands: [
      {
        fromOwner: {
          kind: "deploymentProjection",
          slotId: "AP:default:api",
          taskId: "task-1",
        },
        kind: "rekey",
        toOwner: {
          kind: "resource",
          ref: { kind: "AP", name: "api", namespace: "default" },
        },
      },
    ],
    expectedVersion: 7,
    kind: "placement-commands",
  });
});

test("resource snapshot keeps unresolved result slots beside handed-off resource layout", () => {
  const snapshot = buildProjectCanvasResourceSnapshot({
    apsData: {
      items: [
        {
          metadata: { name: "api", namespace: "default" },
          spec: { input: {} },
          status: { phase: "Running" },
        },
      ],
    },
    canvasLayout: {
      namespace: "default",
      nodes: [layoutResourceNode("AP", "api", { x: 680, y: 280 })],
      projectId: "project-uid",
      version: 1,
    },
    deployTasks: [
      {
        artifactSummary: {},
        canvasProjection: {
          edges: [
            {
              evidence: "ap-env-raw-source-reference",
              sourceSlotId: "AP:default:api",
              targetSlotId: "DB:default:postgres",
            },
          ],
          slots: [
            {
              anchor: true,
              expectedRef: {
                kind: "AP",
                name: "api",
                namespace: "default",
              },
              id: "AP:default:api",
            },
            {
              expectedRef: {
                kind: "DB",
                name: "postgres",
                namespace: "default",
              },
              id: "DB:default:postgres",
            },
          ],
        },
        completedAt: null,
        id: "task-1",
        namespace: "default",
        phase: "apply",
        projectId: "project-uid",
        status: "applying",
        updatedAt: "2026-06-11T10:00:00.000Z",
      },
    ],
    isEmptyGraphLoading: false,
    kubeconfig: "apiVersion: v1",
    namespace: "default",
  });

  assert.deepEqual(
    snapshot.canvasState.nodes.map((node) => ({
      id: node.id,
      position: node.position,
      type: node.type,
    })),
    [
      {
        id: "ap-api",
        position: { x: 680, y: 280 },
        type: CANVAS_CONTAINER_NODE_TYPE,
      },
      {
        id: "deployment-result-placeholder-task-1-DB:default:postgres",
        position: { x: 1020, y: 280 },
        type: CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE,
      },
    ]
  );
});

test("resource snapshot rekeys deployment slot placement through explicit result mapping", () => {
  const snapshot = buildProjectCanvasResourceSnapshot({
    apsData: {
      items: [
        {
          metadata: { name: "api-live", namespace: "default" },
          spec: { input: {} },
          status: { phase: "Running" },
        },
      ],
    },
    canvasLayout: {
      namespace: "default",
      nodes: [
        deploymentProjectionLayoutNode({
          position: { x: 680, y: 280 },
          slotId: "AP:default:api-draft",
        }),
      ],
      projectId: "project-uid",
      version: 9,
    },
    deployTasks: [
      {
        artifactSummary: {},
        canvasProjection: {
          slots: [
            {
              anchor: true,
              expectedRef: {
                kind: "AP",
                name: "api-draft",
                namespace: "default",
              },
              id: "AP:default:api-draft",
            },
          ],
        },
        completedAt: null,
        id: "task-1",
        namespace: "default",
        phase: "apply",
        projectId: "project-uid",
        resultMappings: [
          {
            actualRef: {
              kind: "AP",
              name: "api-live",
              namespace: "default",
            },
            slotId: "AP:default:api-draft",
          },
        ],
        status: "applying",
        updatedAt: "2026-06-11T10:00:00.000Z",
      } as DeploymentTaskProjection,
    ],
    isEmptyGraphLoading: false,
    kubeconfig: "apiVersion: v1",
    namespace: "default",
  });

  assert.deepEqual(snapshot.canvasState.nodes[0]?.position, {
    x: 680,
    y: 280,
  });
  assert.deepEqual(snapshot.layoutIntent, {
    commands: [
      {
        fromOwner: {
          kind: "deploymentProjection",
          slotId: "AP:default:api-draft",
          taskId: "task-1",
        },
        kind: "rekey",
        toOwner: {
          kind: "resource",
          ref: { kind: "AP", name: "api-live", namespace: "default" },
        },
      },
    ],
    expectedVersion: 9,
    kind: "placement-commands",
  });
});

test("resource snapshot connects preview edges through explicit result mapping", () => {
  const snapshot = buildProjectCanvasResourceSnapshot({
    apsData: {
      items: [
        {
          metadata: { name: "api-live", namespace: "default" },
          spec: { input: {} },
          status: { phase: "Running" },
        },
      ],
    },
    canvasLayout: {
      namespace: "default",
      nodes: [
        deploymentProjectionLayoutNode({
          position: { x: 680, y: 280 },
          slotId: "AP:default:api-draft",
        }),
      ],
      projectId: "project-uid",
      version: 9,
    },
    deployTasks: [
      {
        artifactSummary: {},
        canvasProjection: {
          edges: [
            {
              evidence: "ap-env-raw-source-reference",
              sourceSlotId: "AP:default:api-draft",
              targetSlotId: "DB:default:postgres",
            },
          ],
          slots: [
            {
              anchor: true,
              expectedRef: {
                kind: "AP",
                name: "api-draft",
                namespace: "default",
              },
              id: "AP:default:api-draft",
            },
            {
              expectedRef: {
                kind: "DB",
                name: "postgres",
                namespace: "default",
              },
              id: "DB:default:postgres",
            },
          ],
        },
        completedAt: null,
        id: "task-1",
        namespace: "default",
        phase: "apply",
        projectId: "project-uid",
        resultMappings: [
          {
            actualRef: {
              kind: "AP",
              name: "api-live",
              namespace: "default",
            },
            slotId: "AP:default:api-draft",
          },
        ],
        status: "applying",
        updatedAt: "2026-06-11T10:00:00.000Z",
      } as DeploymentTaskProjection,
    ],
    isEmptyGraphLoading: false,
    kubeconfig: "apiVersion: v1",
    namespace: "default",
  });

  assert.deepEqual(
    snapshot.canvasState.edges.map((edge) => ({
      data: edge.data,
      source: edge.source,
      target: edge.target,
    })),
    [
      {
        data: {
          evidence: "ap-env-raw-source-reference",
          kind: "deploymentPreview",
        },
        source: "ap-api-live",
        target: "deployment-result-placeholder-task-1-DB:default:postgres",
      },
    ]
  );
});

test("resource snapshot consumes deployment slot when AP layout already exists", () => {
  const snapshot = buildProjectCanvasResourceSnapshot({
    apsData: {
      items: [
        {
          metadata: { name: "api", namespace: "default" },
          spec: { input: {} },
          status: { phase: "Running" },
        },
      ],
    },
    canvasLayout: {
      namespace: "default",
      nodes: [
        layoutResourceNode("AP", "api", { x: 120, y: 80 }),
        {
          owner: {
            kind: "deploymentProjection",
            slotId: "AP:default:api",
            taskId: "task-1",
          },
          position: { x: 680, y: 280 },
        },
      ],
      projectId: "project-uid",
      version: 8,
    },
    deployTasks: [
      {
        artifactSummary: {},
        canvasProjection: {
          slots: [
            {
              expectedRef: {
                kind: "AP",
                name: "api",
                namespace: "default",
              },
              id: "AP:default:api",
            },
          ],
        },
        completedAt: null,
        id: "task-1",
        namespace: "default",
        phase: "apply",
        projectId: "project-uid",
        status: "applying",
        updatedAt: "2026-06-11T10:00:00.000Z",
      },
    ],
    isEmptyGraphLoading: false,
    kubeconfig: "apiVersion: v1",
    namespace: "default",
  });

  assert.deepEqual(snapshot.canvasState.nodes[0]?.position, {
    x: 120,
    y: 80,
  });
  assert.deepEqual(snapshot.layoutIntent, {
    commands: [
      {
        kind: "delete",
        owner: {
          kind: "deploymentProjection",
          slotId: "AP:default:api",
          taskId: "task-1",
        },
      },
    ],
    expectedVersion: 8,
    kind: "placement-commands",
  });
});

test("resource snapshot renders live result before projection placement is recorded", () => {
  const snapshot = buildProjectCanvasResourceSnapshot({
    apsData: {
      items: [
        {
          metadata: { name: "api", namespace: "default" },
          spec: { input: {} },
          status: { phase: "Running" },
        },
      ],
    },
    canvasLayout: {
      namespace: "default",
      nodes: [],
      projectId: "project-uid",
      version: 1,
    },
    deployTasks: [
      {
        artifactSummary: {
          resources: [
            {
              apiVersion: "brain.io/direct",
              kind: "AP",
              name: "api",
              namespace: "default",
            },
          ],
        },
        canvasProjection: {},
        completedAt: null,
        id: "task-1",
        namespace: "default",
        phase: "apply",
        projectId: "project-uid",
        status: "applying",
        updatedAt: "2026-06-11T10:00:00.000Z",
      },
    ],
    isEmptyGraphLoading: false,
    kubeconfig: "apiVersion: v1",
    namespace: "default",
  });

  assert.deepEqual(
    snapshot.canvasState.nodes.map((node) => ({
      id: node.id,
      position: node.position,
      type: node.type,
    })),
    [
      {
        id: "ap-api",
        position: { x: 0, y: 0 },
        type: CANVAS_CONTAINER_NODE_TYPE,
      },
    ]
  );
  assert.deepEqual(snapshot.layoutIntent, {
    kind: "first-placement",
    nodes: [
      {
        expanded: false,
        owner: {
          kind: "resource",
          ref: { kind: "AP", name: "api", namespace: "default" },
        },
        position: { x: 0, y: 0 },
        source: "generated",
      },
    ],
  });
});

test("resource snapshot does not keep template support resources as placeholders after canvas results appear", () => {
  const snapshot = buildProjectCanvasResourceSnapshot({
    apsData: {
      items: [
        {
          metadata: { name: "wordpress-nblvip", namespace: "default" },
          spec: {
            input: {
              network: {
                platformAddresses: [{ id: "pa_wordpress", port: 80 }],
              },
            },
          },
          status: { phase: "Running" },
        },
      ],
    },
    canvasLayout: {
      namespace: "default",
      nodes: [],
      projectId: "project-uid",
      version: 1,
    },
    dbsData: {
      items: [
        {
          metadata: {
            name: "wordpress-nblvip-mysql",
            namespace: "default",
          },
          spec: { engine: "apecloud-mysql" },
          status: { phase: "Creating" },
        },
      ],
    },
    deployTasks: [
      {
        artifactSummary: {
          resources: [
            {
              apiVersion: "template.sealos.io",
              kind: "instance",
              name: "wordpress-template",
              namespace: "default",
            },
            {
              apiVersion: "template.sealos.io",
              kind: "app",
              name: "wordpress-nblvip",
              namespace: "default",
            },
            {
              apiVersion: "template.sealos.io",
              kind: "cluster",
              name: "wordpress-nblvip-mysql",
              namespace: "default",
            },
            {
              apiVersion: "template.sealos.io",
              kind: "service",
              name: "wordpress-nblvip",
              namespace: "default",
            },
            {
              apiVersion: "template.sealos.io",
              kind: "ingress",
              name: "wordpress-nblvip",
              namespace: "default",
            },
            {
              apiVersion: "template.sealos.io",
              kind: "secret",
              name: "wordpress-nblvip-mysql",
              namespace: "default",
            },
          ],
        },
        canvasProjection: {},
        completedAt: null,
        id: "task-1",
        namespace: "default",
        phase: "apply",
        projectId: "project-uid",
        status: "applying",
        updatedAt: "2026-06-11T10:00:00.000Z",
      },
    ],
    isEmptyGraphLoading: false,
    kubeconfig: "apiVersion: v1",
    namespace: "default",
  });

  assert.deepEqual(
    snapshot.canvasState.nodes.map((node) => ({
      id: node.id,
      type: node.type,
    })),
    [
      { id: "ap-wordpress-nblvip", type: CANVAS_CONTAINER_NODE_TYPE },
      { id: "db-wordpress-nblvip-mysql", type: CANVAS_DATABASE_NODE_TYPE },
      { id: "entry-wordpress-nblvip", type: CANVAS_ENTRY_NODE_TYPE },
    ]
  );
  assert.equal(
    snapshot.canvasState.nodes.some(
      (node) => node.type === CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE
    ),
    false
  );
});

test("resource snapshot previews AP public access as related result placeholders", () => {
  const snapshot = buildProjectCanvasResourceSnapshot({
    canvasLayout: {
      namespace: "default",
      nodes: [],
      projectId: "project-uid",
      version: 1,
    },
    deployTasks: [
      {
        artifactSummary: {
          resourceYamls: [
            `
apiVersion: brain.io/direct
kind: AP
metadata:
  name: api
  namespace: default
spec:
  input:
    network:
      platformAddresses:
        - https://api.example.test
`,
          ],
        },
        canvasProjection: {},
        completedAt: null,
        id: "task-1",
        namespace: "default",
        phase: "apply",
        projectId: "project-uid",
        status: "applying",
        updatedAt: "2026-06-11T10:00:00.000Z",
      },
    ],
    isEmptyGraphLoading: false,
    kubeconfig: "apiVersion: v1",
    namespace: "default",
  });

  assert.deepEqual(
    snapshot.canvasState.nodes.map((node) => ({
      id: node.id,
      position: node.position,
      type: node.type,
    })),
    [
      {
        id: "deployment-result-placeholder-task-1-AP:default:api",
        position: { x: 340, y: 0 },
        type: CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE,
      },
      {
        id: "deployment-result-placeholder-task-1-PublicAccess:default:api",
        position: { x: 0, y: 0 },
        type: CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE,
      },
    ]
  );
  assert.deepEqual(
    snapshot.canvasState.edges.map((edge) => ({
      data: edge.data,
      source: edge.source,
      target: edge.target,
    })),
    [
      {
        data: {
          evidence: "ap-public-access-intent",
          kind: "deploymentPreview",
        },
        source: "deployment-result-placeholder-task-1-PublicAccess:default:api",
        target: "deployment-result-placeholder-task-1-AP:default:api",
      },
    ]
  );
});

test("resource snapshot refines unknown deployment placement into AP public access group", () => {
  const snapshot = buildProjectCanvasResourceSnapshot({
    canvasLayout: {
      namespace: "default",
      nodes: [
        deploymentProjectionLayoutNode({
          position: { x: 680, y: 280 },
          slotId: DEPLOYMENT_UNKNOWN_SLOT_ID,
        }),
      ],
      projectId: "project-uid",
      version: 1,
    },
    deployTasks: [
      {
        artifactSummary: {
          resourceYamls: [
            `
apiVersion: brain.io/direct
kind: AP
metadata:
  name: api
  namespace: default
spec:
  input:
    network:
      platformAddresses:
        - https://api.example.test
`,
          ],
        },
        canvasProjection: {},
        completedAt: null,
        id: "task-1",
        namespace: "default",
        phase: "apply",
        projectId: "project-uid",
        status: "applying",
        updatedAt: "2026-06-11T10:00:00.000Z",
      },
    ],
    isEmptyGraphLoading: false,
    kubeconfig: "apiVersion: v1",
    namespace: "default",
  });

  assert.deepEqual(
    snapshot.canvasState.nodes.map((node) => ({
      id: node.id,
      position: node.position,
      type: node.type,
    })),
    [
      {
        id: "deployment-result-placeholder-task-1-AP:default:api",
        position: { x: 680, y: 280 },
        type: CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE,
      },
      {
        id: "deployment-result-placeholder-task-1-PublicAccess:default:api",
        position: { x: 340, y: 280 },
        type: CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE,
      },
    ]
  );
  assert.deepEqual(snapshot.layoutIntent, {
    commands: [
      {
        fromOwner: {
          kind: "deploymentProjection",
          slotId: DEPLOYMENT_UNKNOWN_SLOT_ID,
          taskId: "task-1",
        },
        kind: "rekey",
        toOwner: {
          kind: "deploymentProjection",
          slotId: "AP:default:api",
          taskId: "task-1",
        },
      },
      {
        kind: "create",
        owner: {
          kind: "deploymentProjection",
          slotId: "PublicAccess:default:api",
          taskId: "task-1",
        },
        position: { x: 340, y: 280 },
        source: "generated",
      },
    ],
    expectedVersion: 1,
    kind: "placement-commands",
  });
});

test("resource snapshot preserves independent AP public access slot handoff positions", () => {
  const snapshot = buildProjectCanvasResourceSnapshot({
    apsData: {
      items: [
        {
          metadata: { name: "api", namespace: "default" },
          spec: {
            input: {
              network: {
                platformAddresses: [{ id: "pa_abc123", port: 80 }],
              },
            },
          },
          status: { phase: "Running" },
        },
      ],
    },
    canvasLayout: {
      namespace: "default",
      nodes: [
        deploymentProjectionLayoutNode({
          position: { x: 680, y: 280 },
          slotId: "AP:default:api",
        }),
        deploymentProjectionLayoutNode({
          position: { x: 120, y: 640 },
          slotId: "PublicAccess:default:api",
        }),
      ],
      projectId: "project-uid",
      version: 1,
    },
    deployTasks: [
      {
        artifactSummary: {},
        canvasProjection: {
          edges: [
            {
              evidence: "ap-public-access-intent",
              sourceSlotId: "PublicAccess:default:api",
              targetSlotId: "AP:default:api",
            },
          ],
          slots: [
            {
              anchor: true,
              expectedRef: {
                kind: "AP",
                name: "api",
                namespace: "default",
              },
              id: "AP:default:api",
            },
            {
              expectedRef: {
                kind: "PublicAccess",
                name: "api",
                namespace: "default",
              },
              id: "PublicAccess:default:api",
            },
          ],
        },
        completedAt: null,
        id: "task-1",
        namespace: "default",
        phase: "apply",
        projectId: "project-uid",
        status: "applying",
        updatedAt: "2026-06-11T10:00:00.000Z",
      },
    ],
    isEmptyGraphLoading: false,
    kubeconfig: "apiVersion: v1",
    namespace: "default",
  });

  assert.deepEqual(
    snapshot.canvasState.nodes.map((node) => ({
      id: node.id,
      position: node.position,
      type: node.type,
    })),
    [
      {
        id: "ap-api",
        position: { x: 680, y: 280 },
        type: CANVAS_CONTAINER_NODE_TYPE,
      },
      {
        id: "entry-api",
        position: { x: 120, y: 640 },
        type: CANVAS_ENTRY_NODE_TYPE,
      },
    ]
  );
  assert.deepEqual(snapshot.layoutIntent, {
    commands: [
      {
        fromOwner: {
          kind: "deploymentProjection",
          slotId: "AP:default:api",
          taskId: "task-1",
        },
        kind: "rekey",
        toOwner: {
          kind: "resource",
          ref: { kind: "AP", name: "api", namespace: "default" },
        },
      },
      {
        fromOwner: {
          kind: "deploymentProjection",
          slotId: "PublicAccess:default:api",
          taskId: "task-1",
        },
        kind: "rekey",
        toOwner: {
          kind: "resource",
          ref: { kind: "PublicAccess", name: "api", namespace: "default" },
        },
      },
    ],
    expectedVersion: 1,
    kind: "placement-commands",
  });
});

test("resource snapshot keeps unresolved result slots beside handed-off results", () => {
  const snapshot = buildProjectCanvasResourceSnapshot({
    apsData: {
      items: [
        {
          metadata: { name: "api", namespace: "default" },
          spec: { input: {} },
          status: { phase: "Running" },
        },
      ],
    },
    canvasLayout: {
      namespace: "default",
      nodes: [
        deploymentProjectionLayoutNode({
          position: { x: 680, y: 280 },
          slotId: "AP:default:api",
        }),
      ],
      projectId: "project-uid",
      version: 1,
    },
    deployTasks: [
      {
        artifactSummary: {},
        canvasProjection: {
          edges: [
            {
              evidence: "ap-env-raw-source-reference",
              sourceSlotId: "AP:default:api",
              targetSlotId: "DB:default:postgres",
            },
          ],
          slots: [
            {
              anchor: true,
              expectedRef: {
                kind: "AP",
                name: "api",
                namespace: "default",
              },
              id: "AP:default:api",
            },
            {
              expectedRef: {
                kind: "DB",
                name: "postgres",
                namespace: "default",
              },
              id: "DB:default:postgres",
            },
          ],
        },
        completedAt: null,
        id: "task-1",
        namespace: "default",
        phase: "apply",
        projectId: "project-uid",
        status: "applying",
        updatedAt: "2026-06-11T10:00:00.000Z",
      },
    ],
    isEmptyGraphLoading: false,
    kubeconfig: "apiVersion: v1",
    namespace: "default",
  });

  assert.deepEqual(
    snapshot.canvasState.nodes.map((node) => ({
      id: node.id,
      position: node.position,
      type: node.type,
    })),
    [
      {
        id: "ap-api",
        position: { x: 680, y: 280 },
        type: CANVAS_CONTAINER_NODE_TYPE,
      },
      {
        id: "deployment-result-placeholder-task-1-DB:default:postgres",
        position: { x: 1020, y: 280 },
        type: CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE,
      },
    ]
  );
  assert.deepEqual(
    snapshot.canvasState.edges.map((edge) => ({
      data: edge.data,
      source: edge.source,
      target: edge.target,
    })),
    [
      {
        data: {
          evidence: "ap-env-raw-source-reference",
          kind: "deploymentPreview",
        },
        source: "ap-api",
        target: "deployment-result-placeholder-task-1-DB:default:postgres",
      },
    ]
  );
});

test("resource snapshot does not let placeholder handoff override saved resource layout", () => {
  const snapshot = buildProjectCanvasResourceSnapshot({
    apsData: {
      items: [
        {
          metadata: { name: "api", namespace: "default" },
          spec: { input: {} },
          status: { phase: "Running" },
        },
      ],
    },
    canvasLayout: {
      namespace: "default",
      nodes: [
        layoutResourceNode("AP", "api", { x: 120, y: 80 }),
        deploymentProjectionLayoutNode({
          position: { x: 680, y: 280 },
          slotId: "AP:default:api",
        }),
      ],
      projectId: "project-uid",
      version: 1,
    },
    deployTasks: [
      {
        artifactSummary: {
          resources: [
            {
              apiVersion: "brain.io/direct",
              kind: "AP",
              name: "api",
              namespace: "default",
            },
          ],
        },
        canvasProjection: {},
        completedAt: "2026-06-11T10:00:00.000Z",
        id: "task-1",
        namespace: "default",
        phase: "completed",
        projectId: "project-uid",
        status: "completed",
        updatedAt: "2026-06-11T10:00:00.000Z",
      },
    ],
    isEmptyGraphLoading: false,
    kubeconfig: "apiVersion: v1",
    namespace: "default",
  });

  assert.deepEqual(snapshot.canvasState.nodes[0]?.position, { x: 120, y: 80 });
  assert.deepEqual(snapshot.layoutIntent, {
    commands: [
      {
        kind: "delete",
        owner: {
          kind: "deploymentProjection",
          slotId: "AP:default:api",
          taskId: "task-1",
        },
      },
    ],
    expectedVersion: 1,
    kind: "placement-commands",
  });
});
