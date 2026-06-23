import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CANVAS_CONTAINER_NODE_TYPE,
  CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE,
  CANVAS_ENTRY_NODE_TYPE,
} from "@/features/project-canvas/nodes/constants";
import { projectRuntimeFactsFromResources } from "@/features/project-runtime/resource-facts";
import { projectRuntimeResourceTopologyFromFacts } from "@/features/project-runtime/resource-store";
import type { DeploymentTaskProjection } from "@/lib/deploy-task/projection";
import { DEPLOYMENT_UNKNOWN_SLOT_ID } from "../layout/placement-owner";
import type { CanvasLayoutDocument, CanvasLayoutNode } from "../layout/types";
import {
  projectCanvasRuntimeResourceGraph,
  projectCanvasRuntimeShellNodesFromResources,
} from "./resource-graph";

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
  });

  assert.deepEqual(graph.layoutIntent, {
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
  assert.deepEqual(graph.layoutIntent, {
    commands: [
      {
        kind: "create",
        owner: {
          kind: "deploymentProjection",
          slotId: "AP:default:api",
          taskId: "task-1",
        },
        position: { x: 1020, y: 280 },
        source: "generated",
      },
      {
        kind: "create",
        owner: {
          kind: "deploymentProjection",
          slotId: "PublicAccess:default:api",
          taskId: "task-1",
        },
        position: { x: 680, y: 280 },
        source: "generated",
      },
      {
        kind: "delete",
        owner: {
          kind: "deploymentProjection",
          slotId: DEPLOYMENT_UNKNOWN_SLOT_ID,
          taskId: "task-1",
        },
      },
    ],
    expectedVersion: 1,
    kind: "placement-commands",
  });
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
