import assert from "node:assert/strict";
import { test } from "node:test";
import type { DeploymentTaskProjection } from "@/features/deploy/task/projection";
import {
  CANVAS_CONTAINER_NODE_TYPE,
  CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE,
  CANVAS_ENTRY_NODE_TYPE,
} from "@/features/project-canvas/nodes/constants";
import { projectRuntimeFactsFromResources } from "@/features/project-canvas/runtime/resource-facts";
import { projectRuntimeResourceTopologyFromFacts } from "@/features/project-canvas/runtime/resource-store";
import { applyCanvasLayoutPatch } from "../layout/patch";
import { DEPLOYMENT_UNKNOWN_SLOT_ID } from "../layout/placement-owner";
import type { CanvasLayoutDocument, CanvasLayoutNode } from "../layout/types";
import {
  projectCanvasRuntimeResourceGraph,
  projectCanvasRuntimeShellNodesFromResources,
} from "./resource-graph";

const NOW = new Date("2026-06-11T10:00:00.000Z");

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

test("Project Canvas runtime graph applies Canvas Layout to thin resource shell nodes", () => {
  const runtimeFacts = projectRuntimeFactsFromResources({
    apsData: {
      items: [
        {
          metadata: { name: "api", namespace: "default", uid: "ap-uid" },
          spec: { input: { image: "nginx:1.27" } },
          status: { phase: "Running" },
        },
      ],
    },
    namespace: "default",
  });
  const resourceTopology =
    projectRuntimeResourceTopologyFromFacts(runtimeFacts);
  const [shellNode] =
    projectCanvasRuntimeShellNodesFromResources(resourceTopology);
  const graph = projectCanvasRuntimeResourceGraph({
    canvasLayout: {
      namespace: "default",
      nodes: [
        {
          expanded: true,
          owner: {
            kind: "resource",
            ref: { kind: "AP", name: "api", namespace: "default" },
          },
          position: { x: 420, y: 240 },
          stackOrder: 7,
        },
      ],
      projectId: "project-uid",
      version: 3,
    },
    relationshipIndexes: runtimeFacts.relationshipIndexes,
    resourceTopology,
    now: NOW,
  });

  const [node] = graph.canvasState.nodes;
  assert.equal(node?.id, "ap-api");
  assert.equal(node?.type, CANVAS_CONTAINER_NODE_TYPE);
  assert.deepEqual(node?.position, { x: 420, y: 240 });
  assert.deepEqual(node?.data, {
    layout: { expanded: true, stackOrder: 7 },
    runtime: {
      kind: "AP",
      modelKey: "AP:default:api",
      observedUid: "ap-uid",
      placementOwnerKey: "AP:default:api",
      resourceRef: { kind: "AP", name: "api", namespace: "default" },
    },
  });
  assert.equal("states" in (shellNode?.data ?? {}), false);
  assert.equal("resource" in (shellNode?.data ?? {}), false);
});

test("Project Canvas runtime graph emits first-placement intent for new shell nodes", () => {
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
  const graph = projectCanvasRuntimeResourceGraph({
    canvasLayout: {
      namespace: "default",
      nodes: [],
      projectId: "project-uid",
      version: 1,
    },
    relationshipIndexes: runtimeFacts.relationshipIndexes,
    resourceTopology: projectRuntimeResourceTopologyFromFacts(runtimeFacts),
    now: NOW,
  });

  assert.deepEqual(graph.layoutIntent, {
    commands: [],
    expectedVersion: 1,
    kind: "transaction",
    nodes: [
      {
        expanded: true,
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

test("Project Canvas runtime graph emits unversioned First Placement for the repository's empty version-zero layout", () => {
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

  const graph = projectCanvasRuntimeResourceGraph({
    canvasLayout: {
      namespace: "default",
      nodes: [],
      projectId: "project-uid",
      version: 0,
    },
    now: NOW,
    relationshipIndexes: runtimeFacts.relationshipIndexes,
    resourceTopology: projectRuntimeResourceTopologyFromFacts(runtimeFacts),
  });

  assert.deepEqual(graph.layoutIntent, {
    kind: "first-placement",
    nodes: [
      {
        expanded: true,
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

test("Project Canvas runtime graph hides resource shells until Canvas Layout is ready", () => {
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

  const graph = projectCanvasRuntimeResourceGraph({
    canvasLayoutReady: false,
    now: NOW,
    relationshipIndexes: runtimeFacts.relationshipIndexes,
    resourceTopology: projectRuntimeResourceTopologyFromFacts(runtimeFacts),
  });

  assert.deepEqual(graph.canvasState.nodes, []);
  assert.deepEqual(graph.canvasState.edges, []);
  assert.equal(graph.layoutIntent, null);
});

test("Project Canvas runtime graph refines unknown deployment placement into AP public access group", () => {
  const deployTasks: DeploymentTaskProjection[] = [
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
  ];
  const canvasLayout: CanvasLayoutDocument = {
    namespace: "default",
    nodes: [
      deploymentProjectionLayoutNode({
        position: { x: 680, y: 280 },
        slotId: DEPLOYMENT_UNKNOWN_SLOT_ID,
      }),
    ],
    projectId: "project-uid",
    version: 1,
  };

  const graph = projectCanvasRuntimeResourceGraph({
    canvasLayout,
    deployTasks,
    now: NOW,
    relationshipIndexes: projectRuntimeFactsFromResources({
      namespace: "default",
    }).relationshipIndexes,
    resourceTopology: [],
  });

  assert.deepEqual(
    graph.canvasState.nodes.map((node) => ({
      id: node.id,
      position: node.position,
      type: node.type,
    })),
    [
      {
        id: "deployment-result-placeholder-task-1-AP:default:api",
        position: { x: 1020, y: 280 },
        type: CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE,
      },
      {
        id: "deployment-result-placeholder-task-1-PublicAccess:default:api",
        position: { x: 680, y: 280 },
        type: CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE,
      },
    ]
  );
  assert.deepEqual(
    graph.canvasState.edges.map((edge) => ({
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
  assert.equal(graph.layoutIntent?.kind, "transaction");
  if (graph.layoutIntent?.kind !== "transaction") {
    assert.fail("expected one existing-layout transaction");
  }
  assert.equal(graph.layoutIntent.expectedVersion, 1);
  assert.deepEqual(
    graph.layoutIntent.commands.map((command) => command.kind),
    ["create", "create", "delete"]
  );
  const applied = applyCanvasLayoutPatch(canvasLayout, {
    commands: graph.layoutIntent.commands,
    expectedVersion: graph.layoutIntent.expectedVersion,
    intent: "layout",
    nodes: graph.layoutIntent.nodes,
  });
  assert.equal(
    applied.nodes.some(
      (node) =>
        node.owner.kind === "deploymentProjection" &&
        node.owner.slotId === DEPLOYMENT_UNKNOWN_SLOT_ID
    ),
    false
  );
  assert.deepEqual(
    applied.nodes
      .flatMap((node) =>
        node.owner.kind === "deploymentProjection" ? [node.owner.slotId] : []
      )
      .sort(),
    ["AP:default:api", "PublicAccess:default:api"]
  );
});

test("Project Canvas runtime graph keeps live AP public access shell topology AP-bound", () => {
  const runtimeFacts = projectRuntimeFactsFromResources({
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
    namespace: "default",
  });

  const graph = projectCanvasRuntimeResourceGraph({
    now: NOW,
    relationshipIndexes: runtimeFacts.relationshipIndexes,
    resourceTopology: projectRuntimeResourceTopologyFromFacts(runtimeFacts),
  });

  assert.deepEqual(
    graph.canvasState.nodes.map((node) => ({ id: node.id, type: node.type })),
    [
      { id: "ap-api", type: CANVAS_CONTAINER_NODE_TYPE },
      { id: "entry-api", type: CANVAS_ENTRY_NODE_TYPE },
    ]
  );
  assert.deepEqual(
    graph.canvasState.edges.map((edge) => ({
      source: edge.source,
      target: edge.target,
    })),
    [
      {
        source: "entry-api",
        target: "ap-api",
      },
    ]
  );
});

test("Project Canvas runtime graph resolves converging handoffs independent of Task order", () => {
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
  const tasks: DeploymentTaskProjection[] = ["task-1", "task-2"].map((id) => ({
    artifactSummary: {},
    canvasProjection: {
      slots: [
        {
          expectedRef: { kind: "AP", name: "api", namespace: "default" },
          id: "AP:default:api",
        },
      ],
    },
    completedAt: null,
    id,
    namespace: "default",
    phase: "apply",
    projectId: "project-uid",
    status: "applying",
    updatedAt: "2026-06-11T10:00:00.000Z",
  }));
  const canvasLayout: CanvasLayoutDocument = {
    namespace: "default",
    nodes: [
      {
        owner: {
          kind: "deploymentProjection",
          slotId: "AP:default:api",
          taskId: "task-1",
        },
        position: { x: 0, y: 0 },
        source: "generated",
      },
      {
        owner: {
          kind: "deploymentProjection",
          slotId: "AP:default:api",
          taskId: "task-2",
        },
        position: { x: 680, y: 280 },
        source: "user",
      },
    ],
    projectId: "project-uid",
    version: 4,
  };
  const materialize = (deployTasks: DeploymentTaskProjection[]) =>
    projectCanvasRuntimeResourceGraph({
      canvasLayout,
      deployTasks,
      now: NOW,
      relationshipIndexes: runtimeFacts.relationshipIndexes,
      resourceTopology: projectRuntimeResourceTopologyFromFacts(runtimeFacts),
    });

  const forward = materialize(tasks);
  const reversed = materialize([...tasks].reverse());

  assert.deepEqual(reversed, forward);
  assert.deepEqual(forward.canvasState.nodes[0]?.position, { x: 680, y: 280 });
  assert.equal(forward.layoutIntent?.kind, "transaction");
  if (forward.layoutIntent?.kind !== "transaction") {
    assert.fail("expected one existing-layout transaction");
  }
  const applied = applyCanvasLayoutPatch(canvasLayout, {
    commands: forward.layoutIntent.commands,
    expectedVersion: forward.layoutIntent.expectedVersion,
    intent: "layout",
    nodes: forward.layoutIntent.nodes,
  });
  assert.deepEqual(applied.nodes, [
    {
      expanded: true,
      owner: {
        kind: "resource",
        ref: { kind: "AP", name: "api", namespace: "default" },
      },
      position: { x: 680, y: 280 },
      source: "user",
    },
  ]);
});

test("Project Canvas runtime graph uses First Canvas Placement for incompatible handoff placements", () => {
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
  const tasks: DeploymentTaskProjection[] = ["task-1", "task-2"].map((id) => ({
    artifactSummary: {},
    canvasProjection: {
      slots: [
        {
          expectedRef: { kind: "AP", name: "api", namespace: "default" },
          id: "AP:default:api",
        },
      ],
    },
    completedAt: null,
    id,
    namespace: "default",
    phase: "apply",
    projectId: "project-uid",
    status: "applying",
    updatedAt: "2026-06-11T10:00:00.000Z",
  }));
  const canvasLayout: CanvasLayoutDocument = {
    namespace: "default",
    nodes: [
      {
        owner: {
          kind: "deploymentProjection",
          slotId: "AP:default:api",
          taskId: "task-1",
        },
        position: { x: 111, y: 111 },
        source: "user",
      },
      {
        owner: {
          kind: "deploymentProjection",
          slotId: "AP:default:api",
          taskId: "task-2",
        },
        position: { x: 777, y: 333 },
        source: "user",
      },
    ],
    projectId: "project-uid",
    version: 4,
  };
  const materialize = (deployTasks: DeploymentTaskProjection[]) =>
    projectCanvasRuntimeResourceGraph({
      canvasLayout,
      deployTasks,
      now: NOW,
      relationshipIndexes: runtimeFacts.relationshipIndexes,
      resourceTopology: projectRuntimeResourceTopologyFromFacts(runtimeFacts),
    });

  const forward = materialize(tasks);
  assert.deepEqual(materialize([...tasks].reverse()), forward);
  assert.equal(forward.layoutIntent?.kind, "transaction");
  if (forward.layoutIntent?.kind !== "transaction") {
    assert.fail("expected one existing-layout transaction");
  }
  assert.deepEqual(
    forward.layoutIntent.commands.map((command) => command.kind),
    ["delete", "delete"]
  );
  const applied = applyCanvasLayoutPatch(canvasLayout, {
    commands: forward.layoutIntent.commands,
    expectedVersion: forward.layoutIntent.expectedVersion,
    intent: "layout",
    nodes: forward.layoutIntent.nodes,
  });
  const [resourcePlacement] = applied.nodes;
  assert.equal(resourcePlacement?.owner.kind, "resource");
  assert.equal(resourcePlacement?.source, "generated");
  assert.deepEqual(
    resourcePlacement?.position,
    forward.canvasState.nodes[0]?.position
  );
  assert.equal(
    [
      { x: 111, y: 111 },
      { x: 777, y: 333 },
    ].some(
      (position) =>
        position.x === resourcePlacement?.position.x &&
        position.y === resourcePlacement.position.y
    ),
    false
  );
});

test("Project Canvas runtime graph keeps an existing Resource Placement and consumes every projection", () => {
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
  const tasks: DeploymentTaskProjection[] = ["task-1", "task-2"].map((id) => ({
    artifactSummary: {},
    canvasProjection: {
      slots: [
        {
          expectedRef: { kind: "AP", name: "api", namespace: "default" },
          id: "AP:default:api",
        },
      ],
    },
    completedAt: null,
    id,
    namespace: "default",
    phase: "apply",
    projectId: "project-uid",
    status: "applying",
    updatedAt: NOW.toISOString(),
  }));
  const canvasLayout: CanvasLayoutDocument = {
    namespace: "default",
    nodes: [
      {
        owner: {
          kind: "resource",
          ref: { kind: "AP", name: "api", namespace: "default" },
        },
        position: { x: 960, y: 480 },
        source: "user",
      },
      ...tasks.map((task, index) => ({
        owner: {
          kind: "deploymentProjection" as const,
          slotId: "AP:default:api",
          taskId: task.id,
        },
        position: { x: index * 340, y: 0 },
        source: (index === 1 ? "user" : "generated") as "generated" | "user",
      })),
    ],
    projectId: "project-uid",
    version: 4,
  };
  const graph = projectCanvasRuntimeResourceGraph({
    canvasLayout,
    deployTasks: tasks,
    now: NOW,
    relationshipIndexes: runtimeFacts.relationshipIndexes,
    resourceTopology: projectRuntimeResourceTopologyFromFacts(runtimeFacts),
  });

  assert.deepEqual(graph.canvasState.nodes[0]?.position, { x: 960, y: 480 });
  assert.equal(graph.layoutIntent?.kind, "transaction");
  if (graph.layoutIntent?.kind !== "transaction") {
    assert.fail("expected one existing-layout transaction");
  }
  const applied = applyCanvasLayoutPatch(canvasLayout, {
    commands: graph.layoutIntent.commands,
    expectedVersion: graph.layoutIntent.expectedVersion,
    intent: "layout",
    nodes: graph.layoutIntent.nodes,
  });
  assert.deepEqual(applied.nodes, [
    {
      owner: {
        kind: "resource",
        ref: { kind: "AP", name: "api", namespace: "default" },
      },
      position: { x: 960, y: 480 },
      source: "user",
    },
  ]);
});
