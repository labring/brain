import assert from "node:assert/strict";
import { test } from "node:test";

import { parseProjectSideRouteState } from "@/features/panes/side-url-codec";
import { templateDeployProjectPath } from "./template-deploy-link";
import { TEMPLATE_NAME_MAX_LENGTH } from "./template-deployment-intent";

function sideFromPath(path: string) {
  const url = new URL(path, "https://brain.test");
  return parseProjectSideRouteState({ side: url.searchParams.get("side") })
    .side;
}

test("template deploy link opens the requested template creation entry", () => {
  assert.deepEqual(sideFromPath(templateDeployProjectPath("flowise")), {
    entryMode: "templateDirect",
    kind: "projectCreation",
    templateName: "flowise",
  });
});

test("template deploy link trims and safely encodes a template name", () => {
  assert.deepEqual(
    sideFromPath(templateDeployProjectPath("  team:flow / v1  ")),
    {
      entryMode: "templateDirect",
      kind: "projectCreation",
      templateName: "team:flow / v1",
    }
  );
});

test("template deploy link carries the template form into the creation intent", () => {
  assert.deepEqual(
    sideFromPath(
      templateDeployProjectPath(
        "flowise",
        JSON.stringify({ enabled: true, port: "3000" })
      )
    ),
    {
      entryMode: "templateDirect",
      kind: "projectCreation",
      templateForm: JSON.stringify({ enabled: "true", port: "3000" }),
      templateName: "flowise",
    }
  );
});

test("missing, blank, repeated, and overlong names open generic template creation", () => {
  for (const value of [
    undefined,
    null,
    "   ",
    ["flowise", "dify"],
    "x".repeat(TEMPLATE_NAME_MAX_LENGTH + 1),
  ]) {
    assert.deepEqual(sideFromPath(templateDeployProjectPath(value)), {
      entryMode: "templateDirect",
      kind: "projectCreation",
    });
  }
});
