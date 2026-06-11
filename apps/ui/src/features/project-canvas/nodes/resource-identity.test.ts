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

test("Canvas Resource Identity treats container nodes as AP targets", () => {
  const node = {
    data: {
      states: {
        kind: "AP",
        name: "memos",
        namespace: "default",
        uid: "ap-uid",
      },
    },
    id: "ap-memos",
    position: { x: 0, y: 0 },
    type: CANVAS_CONTAINER_NODE_TYPE,
  } as Node;

  assert.deepEqual(canvasResourceIdentityFromNode(node), {
    kind: "AP",
    name: "memos",
    namespace: "default",
  });
  assert.equal(canvasResourceLastSeenUidFromNode(node), "ap-uid");
  assert.equal(canvasNodeSelectionKey(node), "ap-uid");
});

test("Canvas Resource Identity does not treat template container nodes as AP targets", () => {
  const node = {
    data: {
      resourceKind: "template",
      states: {
        kind: "Deployment",
        name: "memos",
        namespace: "default",
        uid: "template-uid",
      },
    },
    id: "template-memos",
    position: { x: 0, y: 0 },
    type: CANVAS_CONTAINER_NODE_TYPE,
  } as Node;

  assert.equal(canvasResourceIdentityFromNode(node), undefined);
  assert.equal(canvasResourceLastSeenUidFromNode(node), undefined);
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

test("PublicAccess identity is the AP-bound Public Addresses surface", () => {
  const node = {
    data: {
      resource: {
        apRef: "web",
        name: "web-public-access",
        namespace: "default",
        uid: "entry-uid",
      },
    },
    id: "entry-web",
    position: { x: 0, y: 0 },
    type: CANVAS_ENTRY_NODE_TYPE,
  } as Node;

  assert.deepEqual(canvasResourceIdentityFromNode(node), {
    kind: "PublicAccess",
    name: "web",
    namespace: "default",
  });
  assert.equal(canvasResourceLastSeenUidFromNode(node), "entry-uid");
  assert.equal(canvasNodeSelectionKey(node), "public-access:default:web");
  assert.deepEqual(apBoundSurfaceRefFromKey("entry:default:web"), {
    apName: "web",
    namespace: "default",
  });
});

test("PublicAccess explicit selection key wins over observed resource uid", () => {
  const node = {
    data: {
      resource: {
        apRef: "web",
        name: "web-public-access",
        namespace: "default",
        selectionKey: "public-access:default:web",
        uid: "entry-uid",
      },
    },
    id: "entry-web",
    position: { x: 0, y: 0 },
    type: CANVAS_ENTRY_NODE_TYPE,
  } as Node;

  assert.equal(canvasNodeSelectionKey(node), "public-access:default:web");
});
