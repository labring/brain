import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { DeploymentTaskProjection } from "@/lib/deploy-task/projection";
import type { DeploymentTaskDockModel } from "./deployment-task-timeline-reentry";
import { ProjectCanvasDeploymentTaskDock } from "./deployment-task-timeline-reentry-affordance";

const DOCK_SLOT_RE = /data-slot="deployment-task-dock"/;
const OPEN_BUTTON_RE = /Open timeline/;
const DISMISS_LABEL_RE = /Dismiss deployment task reminder/;
const DISMISS_LABEL_GLOBAL_RE = /Dismiss deployment task reminder/g;
const CANCEL_ACTION_RE = /Cancel deployment/;
const REDEPLOY_ACTION_RE = /Redeploy/;
const SOURCE_RE = /nginx:latest/;
const RESULT_RE = /AP api/;
const DESKTOP_MORE_RE = /\+1/;
const DESKTOP_MORE_LABEL_RE = /Show 1 more deployment tasks/;
const EXPANDED_LIST_SLOT_RE = /data-slot="deployment-task-dock-list"/;
const EXPANDED_LIST_HEADING_RE = />Deployment tasks</;

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

function countMatches(html: string, pattern: RegExp): number {
  return html.match(pattern)?.length ?? 0;
}

const dock: DeploymentTaskDockModel = {
  desktopHiddenCount: 1,
  desktopTasks: [
    { active: true, task: task({ id: "task-active", status: "applying" }) },
    { active: false, task: task({ id: "task-blocked", status: "blocked" }) },
    { active: false, task: task({ id: "task-failed", status: "failed" }) },
  ],
  mobileHiddenCount: 3,
  mobileTasks: [
    { active: true, task: task({ id: "task-active", status: "applying" }) },
  ],
  tasks: [
    { active: true, task: task({ id: "task-active", status: "applying" }) },
    { active: false, task: task({ id: "task-blocked", status: "blocked" }) },
    { active: false, task: task({ id: "task-failed", status: "failed" }) },
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
  assert.match(html, DESKTOP_MORE_LABEL_RE);
  assert.doesNotMatch(html, OPEN_BUTTON_RE);
  assert.doesNotMatch(html, EXPANDED_LIST_SLOT_RE);
  assert.doesNotMatch(html, EXPANDED_LIST_HEADING_RE);
  // Only the terminal (failed) task is dismissible; the in-progress
  // applying/blocked/queued chips render no ✕ (ADR 0038).
  assert.equal(countMatches(html, DISMISS_LABEL_GLOBAL_RE), 1);
});

test("deployment task dock shows no dismiss for in-progress tasks", () => {
  const inProgress: DeploymentTaskDockModel = {
    desktopHiddenCount: 0,
    desktopTasks: [
      { active: true, task: task({ id: "task-active", status: "applying" }) },
      { active: false, task: task({ id: "task-blocked", status: "blocked" }) },
    ],
    mobileHiddenCount: 1,
    mobileTasks: [
      { active: true, task: task({ id: "task-active", status: "applying" }) },
    ],
    tasks: [
      { active: true, task: task({ id: "task-active", status: "applying" }) },
      { active: false, task: task({ id: "task-blocked", status: "blocked" }) },
    ],
  };
  const html = renderToStaticMarkup(
    <ProjectCanvasDeploymentTaskDock
      dock={inProgress}
      onDismiss={() => undefined}
      onOpen={() => undefined}
    />
  );

  assert.match(html, DOCK_SLOT_RE);
  assert.doesNotMatch(html, DISMISS_LABEL_RE);
});

test("deployment task dock keeps the dismiss control on the active terminal chip", () => {
  const activeFailed: DeploymentTaskDockModel = {
    desktopHiddenCount: 0,
    desktopTasks: [
      { active: true, task: task({ id: "task-failed", status: "failed" }) },
    ],
    mobileHiddenCount: 0,
    mobileTasks: [
      { active: true, task: task({ id: "task-failed", status: "failed" }) },
    ],
    tasks: [
      { active: true, task: task({ id: "task-failed", status: "failed" }) },
    ],
  };
  const html = renderToStaticMarkup(
    <ProjectCanvasDeploymentTaskDock
      dock={activeFailed}
      onDismiss={() => undefined}
      onOpen={() => undefined}
    />
  );

  // Dismissing the open pane's chip records the dismissal and closes the
  // pane, so the control must stay available while the pane is open
  // (CONTEXT.md: Deployment Task Dock Dismissal). Desktop + mobile trees
  // both render, hence two matches.
  assert.equal(countMatches(html, DISMISS_LABEL_GLOBAL_RE), 2);
});

test("deployment task dock never renders cancel or redeploy actions", () => {
  const html = renderToStaticMarkup(
    <ProjectCanvasDeploymentTaskDock
      dock={dock}
      onDismiss={() => undefined}
      onOpen={() => undefined}
    />
  );

  assert.doesNotMatch(html, CANCEL_ACTION_RE);
  assert.doesNotMatch(html, REDEPLOY_ACTION_RE);
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
