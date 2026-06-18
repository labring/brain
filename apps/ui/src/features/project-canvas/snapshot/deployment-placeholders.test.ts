import assert from "node:assert/strict";
import { test } from "node:test";
import type { Node } from "@xyflow/react";

import { DEPLOYMENT_TASK_PROJECTION_COMPLETED_GRACE_MS } from "@/lib/deploy-task/projection";
import { DEPLOYMENT_UNKNOWN_SLOT_ID } from "../layout/placement-owner";
import {
  CANVAS_CONTAINER_NODE_TYPE,
  CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE,
} from "../nodes/constants";
import type {
  CanvasDeploymentPlaceholderNodeData,
  CanvasDeploymentPlaceholderRfNode,
} from "../nodes/types";
import {
  deploymentPlaceholderNodesFromTasks,
  shouldHideDeploymentPlaceholderForHandoff,
} from "./deployment-placeholder-nodes";
import {
  deploymentProjectionPlacementCommands,
  deploymentProjectionPlacementNodesFromPlaceholderNode,
} from "./deployment-placement-commands";
import { deploymentPreviewEdgesFromTasks } from "./deployment-preview-edges";
import { createDeploymentProjectionContext } from "./deployment-projection-context";

const AP_SLOT = {
  expectedRef: {
    kind: "AP",
    name: "api",
    namespace: "default",
  },
  id: "AP:default:api",
} as const;

const PUBLIC_ACCESS_SLOT = {
  expectedRef: {
    kind: "PublicAccess",
    name: "api",
    namespace: "default",
  },
  id: "PublicAccess:default:api",
} as const;

const PROJECTION_SLOTS = [AP_SLOT, PUBLIC_ACCESS_SLOT] as const;

function projectionTask(overrides?: {
  completedAt?: string | null;
  id?: string;
  slots?: typeof PROJECTION_SLOTS;
  status?: "applying" | "completed";
}) {
  return {
    artifactSummary: {},
    canvasProjection: {
      slots: overrides?.slots ?? PROJECTION_SLOTS,
    },
    completedAt: overrides?.completedAt ?? null,
    id: overrides?.id ?? "task-1",
    namespace: "default",
    phase: "apply" as const,
    projectId: "project-uid",
    status: overrides?.status ?? ("applying" as const),
    updatedAt: "2026-06-11T10:00:00.000Z",
  };
}

function unknownSlotLayoutNode(input: {
  position: { x: number; y: number };
  source?: "generated" | "user";
  taskId?: string;
}) {
  return {
    owner: {
      kind: "deploymentProjection" as const,
      slotId: DEPLOYMENT_UNKNOWN_SLOT_ID,
      taskId: input.taskId ?? "task-1",
    },
    position: input.position,
    ...(input.source === undefined ? {} : { source: input.source }),
  };
}

function deploymentLayout(input: {
  nodes: ReturnType<typeof unknownSlotLayoutNode>[];
}) {
  return {
    namespace: "default",
    nodes: input.nodes,
    projectId: "project-uid",
    version: 1,
  };
}

function resultPreviewNode(input: {
  anchorSource?: CanvasDeploymentPlaceholderNodeData["projectionPlacementSource"];
  anchor?: boolean;
  hasProjectionPlacement?: boolean;
  position: CanvasDeploymentPlaceholderRfNode["position"];
  slotId: (typeof PROJECTION_SLOTS)[number]["id"];
}): CanvasDeploymentPlaceholderRfNode {
  const slot = PROJECTION_SLOTS.find((item) => item.id === input.slotId);
  return {
    data: {
      ...(slot?.expectedRef === undefined
        ? {}
        : { expectedRef: slot.expectedRef }),
      groupId: "task-1",
      hasProjectionPlacement: input.hasProjectionPlacement ?? false,
      ...(input.anchor === undefined ? {} : { anchor: input.anchor }),
      ...(input.anchorSource === undefined
        ? {}
        : { projectionPlacementSource: input.anchorSource }),
      projectionSlots: PROJECTION_SLOTS.map((projectionSlot) => ({
        ...projectionSlot,
        ...(projectionSlot.id === AP_SLOT.id ? { anchor: true } : {}),
      })),
      slotId: input.slotId,
      taskId: "task-1",
    },
    id: `deployment-result-placeholder-task-1-${input.slotId}`,
    position: input.position,
    type: CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE,
  };
}

test("handoff hiding uses actual result refs instead of placeholder expected refs", () => {
  const node = resultPreviewNode({
    anchor: true,
    hasProjectionPlacement: true,
    position: { x: 680, y: 280 },
    slotId: AP_SLOT.id,
  });
  const liveActualNode: Node = {
    data: {
      states: {
        image: "ghcr.io/acme/api:v2",
        name: "api-v2",
        namespace: "default",
      },
    },
    id: "ap-api-v2",
    position: { x: 680, y: 280 },
    type: CANVAS_CONTAINER_NODE_TYPE,
  };
  const context = createDeploymentProjectionContext({
    nodes: [liveActualNode],
    tasks: [
      {
        artifactSummary: {},
        canvasProjection: {
          slots: [AP_SLOT],
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
              name: "api-v2",
              namespace: "default",
            },
            slotId: AP_SLOT.id,
          },
        ],
        status: "applying",
        updatedAt: "2026-06-11T10:00:00.000Z",
      },
    ],
  });

  assert.equal(
    shouldHideDeploymentPlaceholderForHandoff({ context, node }),
    true
  );
});

test("unknown placement materializes as the deployment footprint origin", () => {
  const layout = deploymentLayout({
    nodes: [
      unknownSlotLayoutNode({
        position: { x: 120, y: 80 },
        source: "user",
      }),
    ],
  });

  const nodes = deploymentPlaceholderNodesFromTasks([projectionTask()], {
    layout,
  });

  assert.deepEqual(
    nodes.map((node) => ({
      position: node.position,
      relative: node.data.projectionRelativePlacement,
      slotId: node.data.slotId,
      source: node.data.projectionPlacementSource,
    })),
    [
      {
        position: { x: 460, y: 80 },
        relative: { x: 340, y: 0 },
        slotId: AP_SLOT.id,
        source: "user",
      },
      {
        position: { x: 120, y: 80 },
        relative: { x: 0, y: 0 },
        slotId: PUBLIC_ACCESS_SLOT.id,
        source: "user",
      },
    ]
  );
});

test("unknown placement refinement consumes unknown into concrete slot placements", () => {
  const layout = deploymentLayout({
    nodes: [
      unknownSlotLayoutNode({
        position: { x: 120, y: 80 },
        source: "user",
      }),
    ],
  });
  const placeholderNodes = deploymentPlaceholderNodesFromTasks(
    [projectionTask()],
    { layout }
  );

  assert.deepEqual(
    deploymentProjectionPlacementCommands({
      layout,
      nodes: placeholderNodes,
      tasks: [projectionTask()],
    }),
    [
      {
        kind: "create",
        owner: {
          kind: "deploymentProjection",
          slotId: AP_SLOT.id,
          taskId: "task-1",
        },
        position: { x: 460, y: 80 },
        source: "user",
      },
      {
        kind: "create",
        owner: {
          kind: "deploymentProjection",
          slotId: PUBLIC_ACCESS_SLOT.id,
          taskId: "task-1",
        },
        position: { x: 120, y: 80 },
        source: "user",
      },
      {
        kind: "delete",
        owner: {
          kind: "deploymentProjection",
          slotId: DEPLOYMENT_UNKNOWN_SLOT_ID,
          taskId: "task-1",
        },
      },
    ]
  );
});

test("projection patch preserves user source for a slot group anchored by the unknown slot", () => {
  const nodes = [
    resultPreviewNode({
      anchor: true,
      anchorSource: "user",
      position: { x: 680, y: 280 },
      slotId: AP_SLOT.id,
    }),
    resultPreviewNode({
      anchorSource: "user",
      position: { x: 340, y: 280 },
      slotId: PUBLIC_ACCESS_SLOT.id,
    }),
  ];
  const anchorNode = nodes[0];
  assert.ok(anchorNode);

  const placementNodes = deploymentProjectionPlacementNodesFromPlaceholderNode({
    node: anchorNode,
    nodes,
    source: "generated",
  });

  assert.deepEqual(
    placementNodes.map((node) => ({
      owner: node.owner,
      position: node.position,
      source: node.source,
    })),
    [
      {
        owner: {
          kind: "deploymentProjection",
          slotId: AP_SLOT.id,
          taskId: "task-1",
        },
        position: { x: 680, y: 280 },
        source: "user",
      },
      {
        owner: {
          kind: "deploymentProjection",
          slotId: PUBLIC_ACCESS_SLOT.id,
          taskId: "task-1",
        },
        position: { x: 340, y: 280 },
        source: "generated",
      },
    ]
  );
});

test("projection patch moves only the dragged preview slot", () => {
  const nodes = [
    resultPreviewNode({
      anchor: true,
      position: { x: 680, y: 280 },
      slotId: AP_SLOT.id,
    }),
    resultPreviewNode({
      position: { x: 340, y: 280 },
      slotId: PUBLIC_ACCESS_SLOT.id,
    }),
  ];
  const anchorNode = nodes[0];
  assert.ok(anchorNode);
  const movedAp = {
    ...anchorNode,
    position: { x: 780, y: 320 },
  };

  const placementNodes = deploymentProjectionPlacementNodesFromPlaceholderNode({
    node: movedAp,
    nodes,
    source: "user",
  });

  assert.deepEqual(
    placementNodes.map((node) => ({
      owner: node.owner,
      position: node.position,
      source: node.source,
    })),
    [
      {
        owner: {
          kind: "deploymentProjection",
          slotId: AP_SLOT.id,
          taskId: "task-1",
        },
        position: { x: 780, y: 320 },
        source: "user",
      },
    ]
  );
});

test("projection patch preserves sibling preview slots when PublicAccess is dragged", () => {
  const nodes = [
    resultPreviewNode({
      anchor: true,
      position: { x: 680, y: 280 },
      slotId: AP_SLOT.id,
    }),
    resultPreviewNode({
      position: { x: 340, y: 280 },
      slotId: PUBLIC_ACCESS_SLOT.id,
    }),
  ];
  const publicAccessNode = nodes[1];
  assert.ok(publicAccessNode);
  const movedPublicAccess = {
    ...publicAccessNode,
    position: { x: 120, y: 640 },
  };

  const placementNodes = deploymentProjectionPlacementNodesFromPlaceholderNode({
    node: movedPublicAccess,
    nodes,
    source: "user",
  });

  assert.deepEqual(
    placementNodes.map((node) => ({
      owner: node.owner,
      position: node.position,
      source: node.source,
    })),
    [
      {
        owner: {
          kind: "deploymentProjection",
          slotId: PUBLIC_ACCESS_SLOT.id,
          taskId: "task-1",
        },
        position: { x: 120, y: 640 },
        source: "user",
      },
    ]
  );
});

test("preview edges stay scoped to placeholders from their own deployment task", () => {
  const slotIds = ["AP:default:api", "DB:default:postgres"] as const;
  const nodes: Node[] = ["task-1", "task-2"].flatMap((taskId, taskIndex) =>
    slotIds.map((slotId, slotIndex) => ({
      data: {
        expectedRef:
          slotIndex === 0
            ? { kind: "AP", name: "api", namespace: "default" }
            : { kind: "DB", name: "postgres", namespace: "default" },
        projectionSlots: slotIds.map((id) => ({ id })),
        slotId,
        taskId,
      },
      id: `${taskId}-${slotId}`,
      position: { x: taskIndex * 340, y: slotIndex * 280 },
      type: CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE,
    }))
  );

  const edges = deploymentPreviewEdgesFromTasks({
    nodes,
    tasks: ["task-1", "task-2"].map((taskId) => ({
      artifactSummary: {},
      canvasProjection: {
        edges: [
          {
            id: "ap-db",
            sourceSlotId: "AP:default:api",
            targetSlotId: "DB:default:postgres",
          },
        ],
        slots: [
          {
            expectedRef: { kind: "AP", name: "api", namespace: "default" },
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
      id: taskId,
      namespace: "default",
      phase: "apply",
      projectId: "project-uid",
      status: "applying",
      updatedAt: "2026-06-11T10:00:00.000Z",
    })),
  });

  assert.deepEqual(
    edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
    })),
    [
      {
        id: "deployment-preview-task-1-ap-db",
        source: "task-1-AP:default:api",
        target: "task-1-DB:default:postgres",
      },
      {
        id: "deployment-preview-task-2-ap-db",
        source: "task-2-AP:default:api",
        target: "task-2-DB:default:postgres",
      },
    ]
  );
});

test("completed explicit projection slots keep placement during handoff grace", () => {
  const now = new Date("2026-06-11T10:00:00.000Z");
  const layout = {
    namespace: "default",
    nodes: [
      {
        owner: {
          kind: "deploymentProjection" as const,
          slotId: AP_SLOT.id,
          taskId: "task-1",
        },
        position: { x: 680, y: 280 },
      },
    ],
    projectId: "project-uid",
    version: 1,
  };
  const task = {
    artifactSummary: {},
    canvasProjection: {
      slots: [AP_SLOT],
    },
    completedAt: now.toISOString(),
    id: "task-1",
    namespace: "default",
    phase: "completed" as const,
    projectId: "project-uid",
    status: "completed" as const,
    updatedAt: now.toISOString(),
  };

  assert.deepEqual(
    deploymentProjectionPlacementCommands({
      layout,
      nodes: [],
      now,
      tasks: [task],
    }),
    []
  );
  assert.deepEqual(
    deploymentProjectionPlacementCommands({
      layout,
      nodes: [],
      now: new Date(
        now.getTime() + DEPLOYMENT_TASK_PROJECTION_COMPLETED_GRACE_MS + 1
      ),
      tasks: [task],
    }),
    [
      {
        kind: "delete",
        owner: {
          kind: "deploymentProjection",
          slotId: AP_SLOT.id,
          taskId: "task-1",
        },
      },
    ]
  );
});
