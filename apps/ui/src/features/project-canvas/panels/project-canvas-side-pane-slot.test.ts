import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ProjectCanvasSidePaneSlot } from "./project-canvas-side-pane-slot";

const GITHUB_DEPLOYMENT_RE = /GitHub deployment/;
const DATABASE_DEPLOYMENT_RE = /Database deployment/;
const DOCKER_DEPLOYMENT_RE = /Docker deployment/;
const PROJECT_CREATION_RE = /Project creation/;
const RESOURCE_SETTINGS_RE = /Resource settings/;

function renderSlot(
  entry: Parameters<typeof ProjectCanvasSidePaneSlot>[0]["entry"]
) {
  return renderToStaticMarkup(
    createElement(ProjectCanvasSidePaneSlot, {
      entry,
      databaseDeploymentPane: createElement(
        "aside",
        null,
        "Database deployment"
      ),
      dockerDeploymentPane: createElement("aside", null, "Docker deployment"),
      githubDeploymentPane: createElement("aside", null, "GitHub deployment"),
      projectCreationPane: createElement("aside", null, "Project creation"),
      resourcePane: createElement("aside", null, "Resource settings"),
    })
  );
}

test("canvas side pane slot renders the active side entry", () => {
  const html = renderSlot({ kind: "githubDeployment" });

  assert.match(html, GITHUB_DEPLOYMENT_RE);
  assert.doesNotMatch(html, DATABASE_DEPLOYMENT_RE);
  assert.doesNotMatch(html, DOCKER_DEPLOYMENT_RE);
  assert.doesNotMatch(html, RESOURCE_SETTINGS_RE);
});

test("canvas side pane slot renders resource inspection entries", () => {
  const html = renderSlot({ kind: "resource" });

  assert.match(html, RESOURCE_SETTINGS_RE);
  assert.doesNotMatch(html, GITHUB_DEPLOYMENT_RE);
});

test("canvas side pane slot can render Project creation entries", () => {
  const html = renderSlot({ kind: "projectCreation" });

  assert.match(html, PROJECT_CREATION_RE);
  assert.doesNotMatch(html, RESOURCE_SETTINGS_RE);
});

test("canvas side pane slot is absent without an active side entry", () => {
  assert.equal(renderSlot(null), "");
});
