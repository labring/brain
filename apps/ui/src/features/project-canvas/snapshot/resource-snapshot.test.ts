import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CANVAS_CONTAINER_NODE_TYPE,
  CANVAS_DATABASE_NODE_TYPE,
} from "@/features/project-canvas/nodes/constants";
import type { CanvasLayoutDocument } from "../layout/types";
import { buildProjectCanvasResourceSnapshot } from "./resource-snapshot";

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
        position: { x: 0, y: 0 },
        ref: { kind: "AP", name: "api", namespace: "default" },
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
