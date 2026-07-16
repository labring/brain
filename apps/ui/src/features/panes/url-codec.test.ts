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
    kind: "settings",
    target: { kind: "AP", name: "api", namespace: "default" },
    view: "public-addresses",
  },
} satisfies ProjectSurfaceState;

test("project surface URL codec parses and serializes side, main, and drawer slots", () => {
  const serialized = serializeProjectSurfaceUrlState(state);

  assert.deepEqual(serialized, {
    drawer: "ap-terminal:ap:default:api",
    main: "db-access:db:data:pg",
    side: "settings:ap:default:api:public-addresses",
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
    side: "settings:ap:default:api:environment",
  });

  assert.deepEqual(parsed.side, {
    kind: "settings",
    target: { kind: "AP", name: "api", namespace: "default" },
    view: "environment",
  });
  assert.deepEqual(serializeProjectSurfaceUrlState(parsed), {
    side: "settings:ap:default:api:environment",
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

test("project surface URL codec preserves deployment task timeline side entries", () => {
  const parsed = parseProjectSurfaceUrlState({
    side: "deployment-task-timeline:project%3Aalpha:task%3Aone",
  });

  assert.deepEqual(parsed.side, {
    kind: "deploymentTaskTimeline",
    projectId: "project:alpha",
    taskId: "task:one",
  });
  assert.deepEqual(serializeProjectSurfaceUrlState(parsed), {
    side: "deployment-task-timeline:project%3Aalpha:task%3Aone",
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

test("project surface URL codec preserves a template name on direct creation", () => {
  const parsed = parseProjectSurfaceUrlState({
    side: "project-creation:templateDirect:team%3Aflow%20v1",
  });

  assert.deepEqual(parsed.side, {
    entryMode: "templateDirect",
    kind: "projectCreation",
    templateName: "team:flow v1",
  });
  assert.deepEqual(serializeProjectSurfaceUrlState(parsed), {
    side: "project-creation:templateDirect:team%3Aflow%20v1",
  });
});

test("project surface URL codec preserves a template form on direct creation", () => {
  const templateForm = JSON.stringify({ enabled: "true", port: "3000" });
  const encodedTemplateForm = encodeURIComponent(templateForm);
  const parsed = parseProjectSurfaceUrlState({
    side: `project-creation:templateDirect:flowise:${encodedTemplateForm}`,
  });

  assert.deepEqual(parsed.side, {
    entryMode: "templateDirect",
    kind: "projectCreation",
    templateForm,
    templateName: "flowise",
  });
  assert.deepEqual(serializeProjectSurfaceUrlState(parsed), {
    side: `project-creation:templateDirect:flowise:${encodedTemplateForm}`,
  });
});

test("project surface URL codec rejects template names on other creation modes", () => {
  assert.equal(
    parseProjectSurfaceUrlState({
      side: "project-creation:dockerDirect:flowise",
    }).side,
    null
  );
});

test("project surface URL codec rejects blank and overlong template names", () => {
  assert.equal(
    parseProjectSurfaceUrlState({
      side: "project-creation:templateDirect:%20%20",
    }).side,
    null
  );
  assert.equal(
    parseProjectSurfaceUrlState({
      side: `project-creation:templateDirect:${"x".repeat(257)}`,
    }).side,
    null
  );
  assert.deepEqual(
    serializeProjectSurfaceUrlState({
      drawer: null,
      main: null,
      side: {
        entryMode: "templateDirect",
        kind: "projectCreation",
        templateName: "   ",
      },
    }),
    { side: "project-creation:templateDirect" }
  );
});
