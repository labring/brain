import assert from "node:assert/strict";
import { test } from "node:test";

import type { ProjectSurfaceState } from "./surface-state";
import {
  parseProjectSurfaceUrlState,
  serializeProjectSurfaceUrlState,
} from "./url-codec";

const state = {
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
} satisfies ProjectSurfaceState;

test("project surface URL codec parses and serializes side, main, and drawer slots", () => {
  const serialized = serializeProjectSurfaceUrlState(state);

  assert.deepEqual(serialized, {
    drawer: "ap-terminal:ap:default:api",
    main: "db-access:db:data:pg",
    side: "public-addresses:entry:default:api",
  });
  assert.deepEqual(parseProjectSurfaceUrlState(serialized), {
    ...state,
    main: {
      focusPolicy: "focusMain",
      kind: "dbAccess",
      target: { kind: "DB", name: "pg", namespace: "data" },
    },
  });
});

test("project surface URL codec omits empty slots", () => {
  assert.deepEqual(
    serializeProjectSurfaceUrlState({
      drawer: null,
      main: null,
      side: null,
    }),
    {}
  );
});

test("project surface URL codec clears invalid and old query entries safely", () => {
  assert.deepEqual(
    parseProjectSurfaceUrlState({
      drawer: "dbPane:console",
      main: "canvasAction:dbAccess",
      side: "apPane:settings",
    }),
    {
      drawer: null,
      main: null,
      side: null,
    }
  );
});

test("project surface URL codec preserves explicit main focus policy", () => {
  const parsed = parseProjectSurfaceUrlState({
    main: "resource-logs:ap:default:api:keep-side",
  });

  assert.deepEqual(parsed.main, {
    focusPolicy: "keepSideVisible",
    kind: "resourceLogs",
    target: { kind: "AP", name: "api", namespace: "default" },
  });
  assert.equal(
    serializeProjectSurfaceUrlState(parsed).main,
    "resource-logs:ap:default:api:keep-side"
  );
});
