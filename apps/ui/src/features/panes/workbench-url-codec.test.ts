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
    target: { apName: "api", kind: "PublicAccess", namespace: "default" },
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
      kind: "settings",
      target: { kind: "AP", name: "api", namespace: "default" },
      view: "public-addresses",
    },
  },
} satisfies ProjectWorkbenchRouteState;

test("project workbench route codec parses and serializes selected and surface slots", () => {
  const serialized = serializeProjectWorkbenchRouteState(state);

  assert.deepEqual(serialized, {
    drawer: "ap-terminal:ap:default:api",
    main: "db-access:db:data:pg",
    selected: "public-access:default:api",
    side: "settings:ap:default:api:public-addresses",
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

test("selected resource codec round-trips AP, DB, and PublicAccess observed UIDs", () => {
  const selections = [
    {
      kind: "resource" as const,
      target: {
        kind: "AP" as const,
        name: "api:name",
        namespace: "default",
        observedUid: "ap/uid:1",
      },
    },
    {
      kind: "resource" as const,
      target: {
        kind: "DB" as const,
        name: "postgres",
        namespace: "data",
        observedUid: "db-uid",
      },
    },
    {
      kind: "publicAddresses" as const,
      target: {
        apName: "web",
        kind: "PublicAccess" as const,
        namespace: "default",
        observedUid: "ap-public-uid",
      },
    },
  ];

  for (const selection of selections) {
    const serialized = serializeProjectCanvasSelection(selection);
    assert.deepEqual(parseProjectCanvasSelection(serialized), selection);
  }
});

test("selected resource codec keeps legacy three-part selections compatible", () => {
  assert.deepEqual(parseProjectCanvasSelection("ap:default:api"), {
    kind: "resource",
    target: { kind: "AP", name: "api", namespace: "default" },
  });
  assert.deepEqual(parseProjectCanvasSelection("db:data:pg"), {
    kind: "resource",
    target: { kind: "DB", name: "pg", namespace: "data" },
  });
  assert.deepEqual(parseProjectCanvasSelection("public-access:default:web"), {
    kind: "publicAddresses",
    target: {
      apName: "web",
      kind: "PublicAccess",
      namespace: "default",
    },
  });
});

test("selected resource codec rejects empty or malformed observed UIDs", () => {
  assert.equal(parseProjectCanvasSelection("ap:default:api:"), null);
  assert.equal(parseProjectCanvasSelection("ap:default:api:%20"), null);
  assert.equal(parseProjectCanvasSelection("ap:default:api:%E0%A4%A"), null);
  assert.equal(parseProjectCanvasSelection("ap:default:api:uid:extra"), null);
});

test("observed UID is limited to selected and does not change surface codecs", () => {
  const withObservedUids = {
    canvasSelection: {
      kind: "resource" as const,
      target: {
        kind: "AP" as const,
        name: "api",
        namespace: "default",
        observedUid: "selected-uid",
      },
    },
    surfaces: {
      drawer: {
        kind: "apTerminal" as const,
        target: {
          kind: "AP" as const,
          name: "api",
          namespace: "default",
          observedUid: "drawer-uid",
        },
      },
      main: {
        kind: "dbAccess" as const,
        target: {
          kind: "DB" as const,
          name: "pg",
          namespace: "data",
          observedUid: "main-uid",
        },
      },
      side: {
        kind: "settings" as const,
        target: {
          kind: "AP" as const,
          name: "api",
          namespace: "default",
          observedUid: "side-uid",
        },
      },
    },
  } satisfies ProjectWorkbenchRouteState;

  assert.deepEqual(serializeProjectWorkbenchRouteState(withObservedUids), {
    drawer: "ap-terminal:ap:default:api",
    main: "db-access:db:data:pg",
    selected: "ap:default:api:selected-uid",
    side: "settings:ap:default:api",
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

test("project workbench route codec uses DB terminal drawer entries", () => {
  const parsed = parseProjectWorkbenchRouteState({
    drawer: "db-terminal:db:data:pg",
  });

  assert.deepEqual(parsed.surfaces.drawer, {
    kind: "dbTerminal",
    target: { kind: "DB", name: "pg", namespace: "data" },
  });
  assert.equal(
    serializeProjectWorkbenchRouteState(parsed).drawer,
    "db-terminal:db:data:pg"
  );
});

test("project workbench route codec preserves AP Environment Settings focus", () => {
  const parsed = parseProjectWorkbenchRouteState({
    selected: "ap:default:api",
    side: "settings:ap:default:api:environment",
  });

  assert.deepEqual(parsed.surfaces.side, {
    kind: "settings",
    target: { kind: "AP", name: "api", namespace: "default" },
    view: "environment",
  });
  assert.equal(
    serializeProjectWorkbenchRouteState(parsed).side,
    "settings:ap:default:api:environment"
  );
});

test("project workbench route codec clears invalid and old query entries safely", () => {
  assert.deepEqual(
    parseProjectWorkbenchRouteState({
      drawer: "db-console:db:data:pg",
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
