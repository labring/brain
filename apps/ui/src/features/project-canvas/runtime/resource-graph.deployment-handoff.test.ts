import assert from "node:assert/strict";
import { test } from "node:test";
import type { DeploymentTaskProjection } from "@/features/deploy/task/projection";
import { DEPLOYMENT_TASK_PROJECTION_COMPLETED_GRACE_MS } from "@/features/deploy/task/projection";
import { applyCanvasLayoutPatch } from "../layout/patch";
import { DEPLOYMENT_UNKNOWN_SLOT_ID } from "../layout/placement-owner";
import type { CanvasLayoutDocument, CanvasLayoutNode } from "../layout/types";
import { CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE } from "../nodes/constants";
import { projectRuntimeFactsFromResources } from "./resource-facts";
import { projectCanvasRuntimeResourceGraph } from "./resource-graph";
import { projectRuntimeResourceTopologyFromFacts } from "./resource-store";

const START = new Date("2026-06-11T10:00:00.000Z");
const AP_ENV_REFERENCE_PREFIX = "$";

function task(input: {
  completedAt?: string | null;
  structured: boolean;
  status?: DeploymentTaskProjection["status"];
}): DeploymentTaskProjection {
  return {
    artifactSummary: {},
    canvasProjection: input.structured
      ? {
          edges: [
            {
              id: "api-postgres",
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
        }
      : {},
    completedAt: input.completedAt ?? null,
    id: "task-1",
    namespace: "default",
    phase: input.status === "completed" ? "completed" : "apply",
    projectId: "project-uid",
    status: input.status ?? "applying",
    updatedAt: START.toISOString(),
  };
}

function layout(nodes: CanvasLayoutNode[], version = 1): CanvasLayoutDocument {
  return {
    namespace: "default",
    nodes,
    projectId: "project-uid",
    version,
  };
}

function singleApTask(input?: {
  actualName?: string;
  expectedName?: string;
  id?: string;
}): DeploymentTaskProjection {
  const expectedName = input?.expectedName ?? "api";
  const slotId = `AP:default:${expectedName}`;
  return {
    artifactSummary: {},
    canvasProjection: {
      slots: [
        {
          expectedRef: {
            kind: "AP",
            name: expectedName,
            namespace: "default",
          },
          id: slotId,
        },
      ],
    },
    completedAt: null,
    id: input?.id ?? "task-1",
    namespace: "default",
    phase: "apply",
    projectId: "project-uid",
    ...(input?.actualName === undefined
      ? {}
      : {
          resultMappings: [
            {
              actualRef: {
                kind: "AP" as const,
                name: input.actualName,
                namespace: "default",
              },
              slotId,
            },
          ],
        }),
    status: "applying",
    updatedAt: START.toISOString(),
  };
}

function applyLayoutIntent(
  current: CanvasLayoutDocument,
  graph: ReturnType<typeof projectCanvasRuntimeResourceGraph>
): CanvasLayoutDocument {
  const intent = graph.layoutIntent;
  if (intent === null) {
    return current;
  }
  if (intent.kind === "first-placement") {
    return applyCanvasLayoutPatch(current, {
      intent: "first-placement",
      nodes: intent.nodes,
    });
  }
  assert.equal(intent.expectedVersion, current.version);
  return applyCanvasLayoutPatch(current, {
    commands: intent.commands,
    expectedVersion: intent.expectedVersion,
    intent: "layout",
    nodes: intent.nodes,
  });
}

function materialize(input: {
  canvasLayout: CanvasLayoutDocument;
  deployTask: DeploymentTaskProjection;
  includeApi?: boolean;
  now: Date;
}) {
  const runtimeFacts = projectRuntimeFactsFromResources({
    ...(input.includeApi
      ? {
          apsData: {
            items: [
              {
                metadata: { name: "api", namespace: "default" },
                spec: { input: {} },
                status: { phase: "Running" },
              },
            ],
          },
        }
      : {}),
    namespace: "default",
  });
  return projectCanvasRuntimeResourceGraph({
    canvasLayout: input.canvasLayout,
    deployTasks: [input.deployTask],
    now: input.now,
    relationshipIndexes: runtimeFacts.relationshipIndexes,
    resourceTopology: projectRuntimeResourceTopologyFromFacts(runtimeFacts),
  });
}

test("Deployment Handoff materializes a stateful unknown-to-expiry lifecycle through the resource graph", () => {
  let canvasLayout = layout([
    {
      owner: {
        kind: "deploymentProjection",
        slotId: DEPLOYMENT_UNKNOWN_SLOT_ID,
        taskId: "task-1",
      },
      position: { x: 120, y: 80 },
      source: "user",
    },
  ]);

  const unknown = materialize({
    canvasLayout,
    deployTask: task({ structured: false }),
    now: START,
  });
  assert.deepEqual(
    unknown.canvasState.nodes.map((node) => ({
      id: node.id,
      position: node.position,
    })),
    [{ id: "deployment-placeholder-task-1", position: { x: 120, y: 80 } }]
  );
  assert.equal(unknown.layoutIntent, null);

  const footprint = materialize({
    canvasLayout,
    deployTask: task({ structured: true }),
    now: START,
  });
  assert.deepEqual(
    footprint.canvasState.nodes.map((node) => ({
      id: node.id,
      position: node.position,
      type: node.type,
    })),
    [
      {
        id: "deployment-result-placeholder-task-1-AP:default:api",
        position: { x: 120, y: 80 },
        type: CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE,
      },
      {
        id: "deployment-result-placeholder-task-1-DB:default:postgres",
        position: { x: 460, y: 80 },
        type: CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE,
      },
    ]
  );
  canvasLayout = applyLayoutIntent(canvasLayout, footprint);
  assert.deepEqual(
    canvasLayout.nodes.map((node) => ({
      owner: node.owner,
      position: node.position,
      source: node.source,
    })),
    [
      {
        owner: {
          kind: "deploymentProjection",
          slotId: "AP:default:api",
          taskId: "task-1",
        },
        position: { x: 120, y: 80 },
        source: "user",
      },
      {
        owner: {
          kind: "deploymentProjection",
          slotId: "DB:default:postgres",
          taskId: "task-1",
        },
        position: { x: 460, y: 80 },
        source: "user",
      },
    ]
  );

  const partialHandoff = materialize({
    canvasLayout,
    deployTask: task({ structured: true }),
    includeApi: true,
    now: START,
  });
  assert.deepEqual(
    partialHandoff.canvasState.nodes.map((node) => node.id),
    ["ap-api", "deployment-result-placeholder-task-1-DB:default:postgres"]
  );
  assert.deepEqual(
    partialHandoff.canvasState.edges.map((edge) => ({
      source: edge.source,
      target: edge.target,
    })),
    [
      {
        source: "ap-api",
        target: "deployment-result-placeholder-task-1-DB:default:postgres",
      },
    ]
  );
  canvasLayout = applyLayoutIntent(canvasLayout, partialHandoff);
  assert.deepEqual(
    [...canvasLayout.nodes]
      .map((node) => ({
        kind: node.owner.kind,
        position: node.position,
        source: node.source,
      }))
      .sort((left, right) => right.kind.localeCompare(left.kind)),
    [
      { kind: "resource", position: { x: 120, y: 80 }, source: "user" },
      {
        kind: "deploymentProjection",
        position: { x: 460, y: 80 },
        source: "user",
      },
    ]
  );

  const completedAt = START.toISOString();
  const completedGrace = materialize({
    canvasLayout,
    deployTask: task({
      completedAt,
      status: "completed",
      structured: true,
    }),
    includeApi: true,
    now: new Date(
      START.getTime() + DEPLOYMENT_TASK_PROJECTION_COMPLETED_GRACE_MS
    ),
  });
  assert.deepEqual(
    completedGrace.canvasState.nodes.map((node) => node.id),
    ["ap-api", "deployment-result-placeholder-task-1-DB:default:postgres"]
  );

  const expired = materialize({
    canvasLayout,
    deployTask: task({
      completedAt,
      status: "completed",
      structured: true,
    }),
    includeApi: true,
    now: new Date(
      START.getTime() + DEPLOYMENT_TASK_PROJECTION_COMPLETED_GRACE_MS + 1
    ),
  });
  assert.deepEqual(
    expired.canvasState.nodes.map((node) => node.id),
    ["ap-api"]
  );
  canvasLayout = applyLayoutIntent(canvasLayout, expired);
  assert.deepEqual(
    canvasLayout.nodes.map((node) => node.owner.kind),
    ["resource"]
  );
});

test("Deployment Handoff accepts explicit result mappings and rejects fuzzy names", () => {
  const runtimeFacts = projectRuntimeFactsFromResources({
    apsData: {
      items: [
        {
          metadata: { name: "api-v2", namespace: "default" },
          spec: { input: {} },
          status: { phase: "Running" },
        },
      ],
    },
    namespace: "default",
  });
  const projectionLayout = layout([
    {
      owner: {
        kind: "deploymentProjection",
        slotId: "AP:default:api",
        taskId: "task-1",
      },
      position: { x: 420, y: 240 },
      source: "user",
    },
  ]);
  const materializeTask = (deployTask: DeploymentTaskProjection) =>
    projectCanvasRuntimeResourceGraph({
      canvasLayout: projectionLayout,
      deployTasks: [deployTask],
      now: START,
      relationshipIndexes: runtimeFacts.relationshipIndexes,
      resourceTopology: projectRuntimeResourceTopologyFromFacts(runtimeFacts),
    });

  const explicitlyMapped = materializeTask(
    singleApTask({ actualName: "api-v2", expectedName: "api" })
  );
  assert.deepEqual(
    explicitlyMapped.canvasState.nodes.map((node) => ({
      id: node.id,
      position: node.position,
    })),
    [{ id: "ap-api-v2", position: { x: 420, y: 240 } }]
  );
  const mappedLayout = applyLayoutIntent(projectionLayout, explicitlyMapped);
  assert.deepEqual(mappedLayout.nodes, [
    {
      expanded: true,
      owner: {
        kind: "resource",
        ref: { kind: "AP", name: "api-v2", namespace: "default" },
      },
      position: { x: 420, y: 240 },
      source: "user",
    },
  ]);

  const fuzzyOnly = materializeTask(singleApTask({ expectedName: "api" }));
  assert.deepEqual(
    fuzzyOnly.canvasState.nodes.map((node) => node.id),
    ["ap-api-v2", "deployment-result-placeholder-task-1-AP:default:api"]
  );
  const fuzzyLayout = applyLayoutIntent(projectionLayout, fuzzyOnly);
  assert.deepEqual(
    fuzzyLayout.nodes.map((node) => node.owner),
    [
      {
        kind: "deploymentProjection",
        slotId: "AP:default:api",
        taskId: "task-1",
      },
      {
        kind: "resource",
        ref: { kind: "AP", name: "api-v2", namespace: "default" },
      },
    ]
  );
});

test("Deployment Preview Edges stay Task-scoped through the resource graph", () => {
  const relationshipIndexes = projectRuntimeFactsFromResources({
    namespace: "default",
  }).relationshipIndexes;
  const tasks = ["task-1", "task-2"].map((id) => ({
    ...task({ structured: true }),
    id,
  }));

  const graph = projectCanvasRuntimeResourceGraph({
    deployTasks: tasks,
    now: START,
    relationshipIndexes,
    resourceTopology: [],
  });

  assert.deepEqual(
    graph.canvasState.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
    })),
    [
      {
        id: "deployment-preview-task-1-api-postgres",
        source: "deployment-result-placeholder-task-1-AP:default:api",
        target: "deployment-result-placeholder-task-1-DB:default:postgres",
      },
      {
        id: "deployment-preview-task-2-api-postgres",
        source: "deployment-result-placeholder-task-2-AP:default:api",
        target: "deployment-result-placeholder-task-2-DB:default:postgres",
      },
    ]
  );
});

test("established Canvas Connection suppresses the equivalent Deployment Preview Edge", () => {
  const runtimeFacts = projectRuntimeFactsFromResources({
    apsData: {
      items: [
        {
          metadata: { name: "api", namespace: "default" },
          spec: {
            input: {
              envRawSource: `DATABASE_URL=${AP_ENV_REFERENCE_PREFIX}{{postgres.DATABASE_URL}}`,
            },
          },
          status: { phase: "Running" },
        },
      ],
    },
    dbsData: {
      items: [
        {
          metadata: { name: "postgres", namespace: "default" },
          spec: { engine: "postgresql" },
          status: { connectionStringPrivate: "postgres://private" },
        },
      ],
    },
    namespace: "default",
  });
  const graph = projectCanvasRuntimeResourceGraph({
    canvasLayout: layout([]),
    deployTasks: [task({ structured: true })],
    now: START,
    relationshipIndexes: runtimeFacts.relationshipIndexes,
    resourceTopology: projectRuntimeResourceTopologyFromFacts(runtimeFacts),
  });

  assert.deepEqual(
    graph.canvasState.edges.map((edge) => edge.id),
    ["detected:AP:default:api->DB:default:postgres"]
  );
});

test("additional maintenance and Deployment Handoff commands share one expected revision", () => {
  const runtimeFacts = projectRuntimeFactsFromResources({
    apsData: {
      items: [
        {
          metadata: { name: "api", namespace: "default" },
          spec: { input: {} },
          status: { phase: "Running" },
        },
      ],
    },
    namespace: "default",
  });
  const staleOwner = {
    kind: "resource" as const,
    ref: { kind: "DB" as const, name: "stale", namespace: "default" },
  };
  const canvasLayout = layout(
    [
      {
        owner: {
          kind: "deploymentProjection",
          slotId: "AP:default:api",
          taskId: "task-1",
        },
        position: { x: 420, y: 240 },
        source: "user",
      },
      { owner: staleOwner, position: { x: 800, y: 240 } },
    ],
    9
  );
  const graph = projectCanvasRuntimeResourceGraph({
    canvasLayout,
    deployTasks: [singleApTask()],
    layoutCommands: [{ kind: "delete", owner: staleOwner }],
    now: START,
    relationshipIndexes: runtimeFacts.relationshipIndexes,
    resourceTopology: projectRuntimeResourceTopologyFromFacts(runtimeFacts),
  });

  assert.equal(graph.layoutIntent?.kind, "transaction");
  if (graph.layoutIntent?.kind !== "transaction") {
    assert.fail("expected one existing-layout transaction");
  }
  assert.equal(graph.layoutIntent.expectedVersion, 9);
  assert.deepEqual(
    graph.layoutIntent.commands.map((command) => command.kind),
    ["delete", "rekey"]
  );
  const applied = applyLayoutIntent(canvasLayout, graph);
  assert.deepEqual(
    applied.nodes.map((node) => node.owner),
    [
      {
        kind: "resource",
        ref: { kind: "AP", name: "api", namespace: "default" },
      },
    ]
  );
  const repeated = projectCanvasRuntimeResourceGraph({
    canvasLayout: applied,
    deployTasks: [singleApTask()],
    now: START,
    relationshipIndexes: runtimeFacts.relationshipIndexes,
    resourceTopology: projectRuntimeResourceTopologyFromFacts(runtimeFacts),
  });
  assert.equal(repeated.layoutIntent, null);
});

test("conflicting user unknown placements fall back to generated resource authority", () => {
  const runtimeFacts = projectRuntimeFactsFromResources({
    apsData: {
      items: [
        {
          metadata: { name: "api", namespace: "default" },
          spec: { input: {} },
          status: { phase: "Running" },
        },
      ],
    },
    namespace: "default",
  });
  const tasks = [
    singleApTask({ id: "task-1" }),
    singleApTask({ id: "task-2" }),
  ];
  const canvasLayout = layout(
    tasks.map((deploymentTask, index) => ({
      owner: {
        kind: "deploymentProjection" as const,
        slotId: DEPLOYMENT_UNKNOWN_SLOT_ID,
        taskId: deploymentTask.id,
      },
      position: index === 0 ? { x: 111, y: 111 } : { x: 777, y: 333 },
      source: "user" as const,
    })),
    4
  );
  const graph = projectCanvasRuntimeResourceGraph({
    canvasLayout,
    deployTasks: tasks,
    now: START,
    relationshipIndexes: runtimeFacts.relationshipIndexes,
    resourceTopology: projectRuntimeResourceTopologyFromFacts(runtimeFacts),
  });

  assert.equal(graph.layoutIntent?.kind, "transaction");
  if (graph.layoutIntent?.kind !== "transaction") {
    assert.fail("expected one existing-layout transaction");
  }
  assert.deepEqual(
    graph.layoutIntent.commands.map((command) => command.kind),
    ["delete", "delete"]
  );
  const applied = applyLayoutIntent(canvasLayout, graph);
  assert.equal(applied.nodes[0]?.source, "generated");
  assert.deepEqual(
    applied.nodes[0]?.position,
    graph.canvasState.nodes[0]?.position
  );
  assert.equal(
    canvasLayout.nodes.some(
      (node) =>
        node.position.x === applied.nodes[0]?.position.x &&
        node.position.y === applied.nodes[0]?.position.y
    ),
    false
  );
});
