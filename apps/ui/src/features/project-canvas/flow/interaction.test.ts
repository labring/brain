import assert from "node:assert/strict";
import { test } from "node:test";

import type { Connection } from "@xyflow/react";

import {
  closestProjectCanvasHandleConnection,
  connectionFromProjectCanvasConnectEndGesture,
  connectionFromProjectCanvasHandles,
  connectionFromSnappedProjectCanvasState,
  connectionFromValidProjectCanvasLine,
  connectionHandleFromConnectStartParams,
  PROJECT_CANVAS_CONNECTION_RADIUS,
  projectCanvasInteractionProps,
} from "./interaction";

test("editable project canvas emits Connecting Edge callbacks", () => {
  const calls: Connection[] = [];
  const props = projectCanvasInteractionProps({
    onConnect: (connection) => calls.push(connection),
    readOnly: false,
  });
  const connection = {
    source: "ap-api",
    sourceHandle: "right",
    target: "db-postgres",
    targetHandle: "left",
  } satisfies Connection;

  assert.equal(props.nodesConnectable, true);
  assert.equal(props.connectionRadius, PROJECT_CANVAS_CONNECTION_RADIUS);
  props.onConnect?.(connection);
  assert.deepEqual(calls, [connection]);
});

test("editable project canvas validates Connecting Edges before connect", () => {
  const connection = {
    source: "ap-api",
    sourceHandle: "right",
    target: "db-postgres",
    targetHandle: "left",
  } satisfies Connection;
  const props = projectCanvasInteractionProps({
    isValidConnection: (candidate) => candidate.target === connection.target,
    onConnect: () => undefined,
    readOnly: false,
  });

  assert.equal(props.isValidConnection?.(connection), true);
  assert.equal(
    props.isValidConnection?.({ ...connection, target: "entry-api" }),
    false
  );
});

test("snapped valid connection state reconstructs the release connection", () => {
  assert.deepEqual(
    connectionFromSnappedProjectCanvasState({
      fromHandle: { id: "right", nodeId: "ap-api", type: "source" },
      isValid: true,
      toHandle: { id: "left", nodeId: "db-postgres", type: "source" },
    }),
    {
      source: "ap-api",
      sourceHandle: "right",
      target: "db-postgres",
      targetHandle: "left",
    }
  );
});

test("snapped target-origin connection state reconstructs source direction", () => {
  assert.deepEqual(
    connectionFromSnappedProjectCanvasState({
      fromHandle: { id: "left", nodeId: "db-postgres", type: "target" },
      isValid: true,
      toHandle: { id: "right", nodeId: "ap-api", type: "source" },
    }),
    {
      source: "ap-api",
      sourceHandle: "right",
      target: "db-postgres",
      targetHandle: "left",
    }
  );
});

test("valid connection line reconstructs the same snapped handle connection", () => {
  const handles = {
    fromHandle: { id: "right", nodeId: "ap-api", type: "source" },
    toHandle: { id: "left", nodeId: "db-postgres", type: "source" },
  } as const;

  assert.deepEqual(connectionFromProjectCanvasHandles(handles), {
    source: "ap-api",
    sourceHandle: "right",
    target: "db-postgres",
    targetHandle: "left",
  });
  assert.deepEqual(
    connectionFromValidProjectCanvasLine({
      connectionStatus: "valid",
      ...handles,
    }),
    {
      source: "ap-api",
      sourceHandle: "right",
      target: "db-postgres",
      targetHandle: "left",
    }
  );
});

test("connect start params preserve the origin handle for release fallback", () => {
  assert.deepEqual(
    connectionHandleFromConnectStartParams({
      handleId: "right",
      handleType: "source",
      nodeId: "ap-api",
    }),
    { id: "right", nodeId: "ap-api", type: "source" }
  );
  assert.equal(
    connectionHandleFromConnectStartParams({
      handleId: "right",
      handleType: null,
      nodeId: "ap-api",
    }),
    null
  );
});

test("connect end gesture resolves snapped fallbacks in one place", () => {
  const connection = {
    source: "ap-api",
    sourceHandle: "right",
    target: "db-postgres",
    targetHandle: "left",
  } satisfies Connection;
  const unsupportedConnection = {
    ...connection,
    target: "entry-api",
  } satisfies Connection;
  const event = { clientX: 0, clientY: 0 } as MouseEvent;
  const isSupportedConnection = (candidate: Connection) =>
    candidate.target === "db-postgres";

  assert.deepEqual(
    connectionFromProjectCanvasConnectEndGesture({
      event,
      fallbackFromHandle: { id: "right", nodeId: "ap-api", type: "source" },
      isSupportedConnection,
      snappedConnection: connection,
      state: { isValid: false },
    }),
    connection
  );

  assert.equal(
    connectionFromProjectCanvasConnectEndGesture({
      event,
      isSupportedConnection,
      snappedConnection: unsupportedConnection,
      state: { isValid: false },
    }),
    undefined
  );
});

test("closest handle fallback uses hidden canvas handles without requiring hover classes", () => {
  const originalHTMLElement = globalThis.HTMLElement;
  interface FakeRect {
    height: number;
    left: number;
    top: number;
    width: number;
  }
  class FakeHandleElement {
    private readonly attrs: Record<string, string>;

    classList: { contains: (className: string) => boolean };

    private readonly rect: FakeRect;

    constructor(
      attrs: Record<string, string>,
      classes: readonly string[],
      rect: FakeRect
    ) {
      this.attrs = attrs;
      this.rect = rect;
      const classNames = new Set(classes);
      this.classList = { contains: (className) => classNames.has(className) };
    }

    getAttribute(name: string) {
      return this.attrs[name] ?? null;
    }

    getBoundingClientRect() {
      return this.rect;
    }
  }
  Object.defineProperty(globalThis, "HTMLElement", {
    configurable: true,
    value: FakeHandleElement,
  });

  try {
    const apHandle = new FakeHandleElement(
      { "data-handleid": "right", "data-nodeid": "ap-api" },
      ["react-flow__handle", "source"],
      { height: 20, left: 90, top: 90, width: 20 }
    );
    const dbHandle = new FakeHandleElement(
      { "data-handleid": "left", "data-nodeid": "db-postgres" },
      ["react-flow__handle", "source"],
      { height: 20, left: 190, top: 90, width: 20 }
    );
    const entryHandle = new FakeHandleElement(
      { "data-handleid": "left", "data-nodeid": "entry-api" },
      ["react-flow__handle", "source"],
      { height: 20, left: 195, top: 90, width: 20 }
    );
    const doc = {
      querySelectorAll: () =>
        [apHandle, dbHandle, entryHandle] as unknown as NodeListOf<Element>,
    } satisfies Pick<Document, "querySelectorAll">;

    assert.deepEqual(
      closestProjectCanvasHandleConnection({
        doc,
        fromHandle: { id: "right", nodeId: "ap-api", type: "source" },
        isSupportedConnection: (connection) =>
          connection.target === "db-postgres",
        point: { x: 201, y: 100 },
        radius: 20,
      })?.connection,
      {
        source: "ap-api",
        sourceHandle: "right",
        target: "db-postgres",
        targetHandle: "left",
      }
    );
  } finally {
    if (originalHTMLElement === undefined) {
      Reflect.deleteProperty(globalThis, "HTMLElement");
    } else {
      Object.defineProperty(globalThis, "HTMLElement", {
        configurable: true,
        value: originalHTMLElement,
      });
    }
  }
});

test("invalid connection line states do not reconstruct snapped connections", () => {
  assert.equal(
    connectionFromValidProjectCanvasLine({
      connectionStatus: "invalid",
      fromHandle: { id: "right", nodeId: "ap-api", type: "source" },
      toHandle: { id: "left", nodeId: "db-postgres", type: "source" },
    }),
    undefined
  );
  assert.equal(
    connectionFromValidProjectCanvasLine({
      connectionStatus: null,
      fromHandle: { id: "right", nodeId: "ap-api", type: "source" },
      toHandle: { id: "left", nodeId: "db-postgres", type: "source" },
    }),
    undefined
  );
});

test("unsnapped or invalid connection states cannot reconstruct release connections", () => {
  assert.equal(
    connectionFromSnappedProjectCanvasState({
      fromHandle: { id: "right", nodeId: "ap-api", type: "source" },
      isValid: true,
      toHandle: null,
    }),
    undefined
  );
  assert.equal(
    connectionFromSnappedProjectCanvasState({
      fromHandle: { id: "right", nodeId: "ap-api", type: "source" },
      isValid: false,
      toHandle: { id: "left", nodeId: "db-postgres", type: "source" },
    }),
    undefined
  );
});

test("read-only project canvas disables Connecting Edge callbacks", () => {
  const calls: Connection[] = [];
  const endCalls: unknown[] = [];
  const validationCalls: Connection[] = [];
  const props = projectCanvasInteractionProps({
    isValidConnection: (connection) => {
      validationCalls.push(connection as Connection);
      return true;
    },
    onConnect: (connection) => calls.push(connection),
    onConnectEnd: (...args) => endCalls.push(args),
    readOnly: true,
  });

  props.onConnect?.({
    source: "ap-api",
    sourceHandle: "right",
    target: "db-postgres",
    targetHandle: "left",
  });

  assert.equal(props.nodesConnectable, false);
  assert.equal(
    props.isValidConnection?.({
      source: "ap-api",
      sourceHandle: "right",
      target: "db-postgres",
      targetHandle: "left",
    }),
    false
  );
  assert.deepEqual(calls, []);
  props.onConnectEnd?.({} as MouseEvent, {} as never);
  assert.deepEqual(endCalls, []);
  assert.deepEqual(validationCalls, []);
});
