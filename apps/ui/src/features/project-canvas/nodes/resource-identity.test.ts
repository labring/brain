import assert from "node:assert/strict";
import { test } from "node:test";

import type { Node } from "@xyflow/react";
import {
  CANVAS_CONTAINER_NODE_TYPE,
  CANVAS_DATABASE_NODE_TYPE,
  CANVAS_ENTRY_NODE_TYPE,
} from "./constants";
import {
  apBoundSurfaceRefFromKey,
  canvasNodeSelectionKey,
  canvasResourceIdentityFromNode,
  canvasResourceKey,
  canvasResourceLastSeenUidFromNode,
} from "./resource-identity";

test("Canvas Resource Identity uses AP kind namespace and name", () => {
  const node = {
    data: {
      states: {
        name: "api",
        namespace: "default",
        uid: "ap-uid",
      },
    },
    id: "ap-api",
    position: { x: 0, y: 0 },
    type: CANVAS_CONTAINER_NODE_TYPE,
  } as Node;

  const identity = canvasResourceIdentityFromNode(node);

  assert.deepEqual(identity, { kind: "AP", name: "api", namespace: "default" });
  assert.equal(
    identity === undefined ? undefined : canvasResourceKey(identity),
    "AP:default:api"
  );
  assert.equal(canvasResourceLastSeenUidFromNode(node), "ap-uid");
  assert.equal(canvasNodeSelectionKey(node), "ap-uid");
});

test("Canvas Resource Identity uses DB workload namespace and name", () => {
  const node = {
    data: {
      uid: "db-uid",
      workload: {
        name: "postgres",
        namespace: "default",
      },
    },
    id: "db-postgres",
    position: { x: 0, y: 0 },
    type: CANVAS_DATABASE_NODE_TYPE,
  } as Node;

  assert.deepEqual(canvasResourceIdentityFromNode(node), {
    kind: "DB",
    name: "postgres",
    namespace: "default",
  });
  assert.equal(canvasResourceLastSeenUidFromNode(node), "db-uid");
  assert.equal(canvasNodeSelectionKey(node), "db-uid");
});

test("EntryPoint identity is the AP-bound Public Addresses surface", () => {
  const node = {
    data: {
      resource: {
        apRef: "web",
        name: "web-entrypoint",
        namespace: "default",
        uid: "entry-uid",
      },
    },
    id: "entry-web",
    position: { x: 0, y: 0 },
    type: CANVAS_ENTRY_NODE_TYPE,
  } as Node;

  assert.deepEqual(canvasResourceIdentityFromNode(node), {
    kind: "EntryPoint",
    name: "web",
    namespace: "default",
  });
  assert.equal(canvasResourceLastSeenUidFromNode(node), "entry-uid");
  assert.equal(canvasNodeSelectionKey(node), "entry:default:web");
  assert.deepEqual(apBoundSurfaceRefFromKey("entry:default:web"), {
    apName: "web",
    namespace: "default",
  });
});

test("EntryPoint explicit selection key wins over observed resource uid", () => {
  const node = {
    data: {
      resource: {
        apRef: "web",
        name: "web-entrypoint",
        namespace: "default",
        selectionKey: "entry:default:web",
        uid: "entry-uid",
      },
    },
    id: "entry-web",
    position: { x: 0, y: 0 },
    type: CANVAS_ENTRY_NODE_TYPE,
  } as Node;

  assert.equal(canvasNodeSelectionKey(node), "entry:default:web");
});
