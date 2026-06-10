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

test("project surface URL codec uses DB terminal drawer entries", () => {
  const parsed = parseProjectSurfaceUrlState({
    drawer: "db-terminal:db:data:pg",
  });

  assert.deepEqual(parsed.drawer, {
    kind: "dbTerminal",
    target: { kind: "DB", name: "pg", namespace: "data" },
  });
  assert.deepEqual(serializeProjectSurfaceUrlState(parsed), {
    drawer: "db-terminal:db:data:pg",
  });
});

test("project surface URL codec preserves AP Environment Settings focus", () => {
  const parsed = parseProjectSurfaceUrlState({
    side: "ap-environment-settings:ap:default:api",
  });

  assert.deepEqual(parsed.side, {
    kind: "apEnvironmentSettings",
    target: { kind: "AP", name: "api", namespace: "default" },
  });
  assert.deepEqual(serializeProjectSurfaceUrlState(parsed), {
    side: "ap-environment-settings:ap:default:api",
  });
});

test("project surface URL codec clears invalid and old query entries safely", () => {
  assert.deepEqual(
    parseProjectSurfaceUrlState({
      drawer: "db-console:db:data:pg",
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

test("project surface URL codec preserves template deployment side entries", () => {
  const parsed = parseProjectSurfaceUrlState({
    side: "template-deployment:project%3Aalpha",
  });

  assert.deepEqual(parsed.side, {
    kind: "templateDeployment",
    projectId: "project:alpha",
  });
  assert.deepEqual(serializeProjectSurfaceUrlState(parsed), {
    side: "template-deployment:project%3Aalpha",
  });
});

test("project surface URL codec preserves template direct project creation", () => {
  const parsed = parseProjectSurfaceUrlState({
    side: "project-creation:templateDirect",
  });

  assert.deepEqual(parsed.side, {
    entryMode: "templateDirect",
    kind: "projectCreation",
  });
  assert.deepEqual(serializeProjectSurfaceUrlState(parsed), {
    side: "project-creation:templateDirect",
  });
});
