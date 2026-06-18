import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { DeploymentTaskProjection } from "@/lib/deploy-task/projection";
import type { DeploymentTaskDockModel } from "./deployment-task-timeline-reentry";
import { ProjectCanvasDeploymentTaskDock } from "./deployment-task-timeline-reentry-affordance";

const DOCK_SLOT_RE = /data-slot="deployment-task-dock"/;
const OPEN_BUTTON_RE = /Open timeline/;
const DISMISS_LABEL_RE = /Dismiss deployment task reminder/;
const SOURCE_RE = /nginx:latest/;
const RESULT_RE = /AP api/;
const DESKTOP_MORE_RE = /\+1/;

function task(overrides: Partial<DeploymentTaskProjection>) {
  return {
    artifactSummary: {},
    canvasProjection: {},
    completedAt: null,
    display: {
      resultSummary: "AP api",
      sourceKind: "docker",
      sourceSummary: "nginx:latest",
    },
    id: "task-1",
    namespace: "default",
    phase: "apply",
    projectId: "project-1",
    status: "running",
    updatedAt: "2026-06-17T10:02:00.000Z",
    ...overrides,
  } satisfies DeploymentTaskProjection;
}

const dock: DeploymentTaskDockModel = {
  desktopHiddenCount: 1,
  desktopTasks: [
    { active: true, task: task({ id: "task-active", status: "applying" }) },
    { active: false, task: task({ id: "task-blocked", status: "blocked" }) },
    { active: false, task: task({ id: "task-running", status: "running" }) },
  ],
  mobileHiddenCount: 3,
  mobileTasks: [
    { active: true, task: task({ id: "task-active", status: "applying" }) },
  ],
  tasks: [
    { active: true, task: task({ id: "task-active", status: "applying" }) },
    { active: false, task: task({ id: "task-blocked", status: "blocked" }) },
    { active: false, task: task({ id: "task-running", status: "running" }) },
    { active: false, task: task({ id: "task-queued", status: "queued" }) },
  ],
};

test("deployment task dock renders tasks as direct timeline entries", () => {
  const html = renderToStaticMarkup(
    <ProjectCanvasDeploymentTaskDock
      dock={dock}
      onDismiss={() => undefined}
      onOpen={() => undefined}
    />
  );

  assert.match(html, DOCK_SLOT_RE);
  assert.match(html, SOURCE_RE);
  assert.match(html, RESULT_RE);
  assert.match(html, DISMISS_LABEL_RE);
  assert.match(html, DESKTOP_MORE_RE);
  assert.doesNotMatch(html, OPEN_BUTTON_RE);
});

test("deployment task dock is absent without tasks", () => {
  const html = renderToStaticMarkup(
    <ProjectCanvasDeploymentTaskDock
      dock={{
        desktopHiddenCount: 0,
        desktopTasks: [],
        mobileHiddenCount: 0,
        mobileTasks: [],
        tasks: [],
      }}
      onDismiss={() => undefined}
      onOpen={() => undefined}
    />
  );

  assert.equal(html, "");
});
