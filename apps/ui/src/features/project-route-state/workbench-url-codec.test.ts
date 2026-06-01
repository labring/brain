import assert from "node:assert/strict";
import { test } from "node:test";

import type { ProjectWorkbenchRouteState } from "./workbench-state";
import {
  parseProjectCanvasSelection,
  parseProjectWorkbenchRouteState,
  serializeProjectCanvasSelection,
  serializeProjectWorkbenchRouteState,
} from "./workbench-url-codec";

const state = {
  canvasSelection: {
    kind: "publicAddresses",
    target: { apName: "api", kind: "EntryPoint", namespace: "default" },
  },
  surfaces: {
    drawer: {
      kind: "apTerminal",
      target: { kind: "AP", name: "api", namespace: "default" },
    },
    main: {
      kind: "dbAccess",
      target: { kind: "DB", name: "pg", namespace: "data" },
    },
    side: {
      kind: "publicAddresses",
      target: { apName: "api", kind: "EntryPoint", namespace: "default" },
    },
  },
} satisfies ProjectWorkbenchRouteState;

test("project workbench route codec parses and serializes selected and surface slots", () => {
  const serialized = serializeProjectWorkbenchRouteState(state);

  assert.deepEqual(serialized, {
    drawer: "ap-terminal:ap:default:api",
    main: "db-access:db:data:pg",
    selected: "entry:default:api",
    side: "public-addresses:entry:default:api",
  });
  assert.deepEqual(parseProjectWorkbenchRouteState(serialized), {
    canvasSelection: state.canvasSelection,
    surfaces: {
      ...state.surfaces,
      main: {
        focusPolicy: "focusMain",
        kind: "dbAccess",
        target: { kind: "DB", name: "pg", namespace: "data" },
      },
    },
  });
});

test("project workbench route codec handles edge selection independently", () => {
  assert.equal(
    serializeProjectCanvasSelection({ edgeId: "edge-1", kind: "edge" }),
    "edge:edge-1"
  );
  assert.deepEqual(parseProjectCanvasSelection("edge:edge-1"), {
    edgeId: "edge-1",
    kind: "edge",
  });
});

test("project workbench route codec omits empty entries as null values", () => {
  assert.deepEqual(
    serializeProjectWorkbenchRouteState({
      canvasSelection: null,
      surfaces: {
        drawer: null,
        main: null,
        side: null,
      },
    }),
    {
      drawer: null,
      main: null,
      selected: null,
      side: null,
    }
  );
});

test("project workbench route codec clears invalid and old query entries safely", () => {
  assert.deepEqual(
    parseProjectWorkbenchRouteState({
      drawer: "dbPane:console",
      main: "canvasAction:dbAccess",
      selected: "service:uid",
      side: "apPane:settings",
    }),
    {
      canvasSelection: null,
      surfaces: {
        drawer: null,
        main: null,
        side: null,
      },
    }
  );
});
