import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { DeploymentTaskProjection } from "@/features/deploy/task/projection";
import type { DeploymentTaskDockItem } from "./deployment-task-timeline-reentry";
import {
  DeploymentTaskDockOverflowList,
  DeploymentTaskDockRow,
  ProjectCanvasDeploymentTaskDock,
} from "./deployment-task-timeline-reentry-affordance";

const DOCK_SLOT_RE = /data-slot="deployment-task-dock"/;
const ROW_SLOT_RE = /data-slot="deployment-task-dock-row"/;
const TASK_SLOT_GLOBAL_RE = /data-slot="deployment-task-dock-task"/g;
const OPEN_BUTTON_RE = /Open timeline/;
const DISMISS_LABEL_RE = /Dismiss deployment task reminder/;
const DISMISS_LABEL_GLOBAL_RE = /Dismiss deployment task reminder/g;
const CANCEL_ACTION_RE = /Cancel deployment/;
const REDEPLOY_ACTION_RE = /Redeploy/;
const SOURCE_RE = /nginx:latest/;
const RESULT_RE = /AP api/;
const MORE_RE = /\+1/;
const MORE_ALL_FOLDED_RE = /\+4/;
const MORE_LABEL_RE = /Show 1 more deployment tasks/;
const LIST_SLOT_RE = /data-slot="deployment-task-dock-list"/;
const LIST_HEADING_RE = />Deployment tasks</;

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

const items: DeploymentTaskDockItem[] = [
  { active: true, task: task({ id: "task-active", status: "applying" }) },
  { active: false, task: task({ id: "task-blocked", status: "blocked" }) },
  { active: false, task: task({ id: "task-failed", status: "failed" }) },
  { active: false, task: task({ id: "task-queued", status: "queued" }) },
];

test("deployment task dock row renders visible chips and folds the rest", () => {
  const html = renderToStaticMarkup(
    <DeploymentTaskDockRow
      items={items}
      onDismiss={() => undefined}
      onOpen={() => undefined}
      visibleCount={3}
    />
  );

  assert.match(html, ROW_SLOT_RE);
  assert.match(html, SOURCE_RE);
  assert.match(html, RESULT_RE);
  assert.equal(countMatches(html, TASK_SLOT_GLOBAL_RE), 3);
  assert.match(html, MORE_RE);
  assert.match(html, MORE_LABEL_RE);
  assert.doesNotMatch(html, OPEN_BUTTON_RE);
  assert.doesNotMatch(html, LIST_SLOT_RE);
  assert.doesNotMatch(html, LIST_HEADING_RE);
  // Only the terminal (failed) task is dismissible; the in-progress
  // applying/blocked chips render no ✕ (ADR 0038).
  assert.equal(countMatches(html, DISMISS_LABEL_GLOBAL_RE), 1);
});

test("deployment task dock row degrades to the overflow trigger alone", () => {
  const html = renderToStaticMarkup(
    <DeploymentTaskDockRow
      items={items}
      onDismiss={() => undefined}
      onOpen={() => undefined}
      visibleCount={0}
    />
  );

  assert.equal(countMatches(html, TASK_SLOT_GLOBAL_RE), 0);
  assert.match(html, MORE_ALL_FOLDED_RE);
});

test("deployment task dock row shows no dismiss for in-progress tasks", () => {
  const inProgress: DeploymentTaskDockItem[] = [
    { active: true, task: task({ id: "task-active", status: "applying" }) },
    { active: false, task: task({ id: "task-blocked", status: "blocked" }) },
  ];
  const html = renderToStaticMarkup(
    <DeploymentTaskDockRow
      items={inProgress}
      onDismiss={() => undefined}
      onOpen={() => undefined}
      visibleCount={2}
    />
  );

  assert.match(html, ROW_SLOT_RE);
  assert.doesNotMatch(html, DISMISS_LABEL_RE);
});

test("deployment task dock row keeps the dismiss control on the active terminal chip", () => {
  const activeFailed: DeploymentTaskDockItem[] = [
    { active: true, task: task({ id: "task-failed", status: "failed" }) },
  ];
  const html = renderToStaticMarkup(
    <DeploymentTaskDockRow
      items={activeFailed}
      onDismiss={() => undefined}
      onOpen={() => undefined}
      visibleCount={1}
    />
  );

  // Dismissing the open pane's chip records the dismissal and closes the
  // pane, so the control must stay available while the pane is open
  // (CONTEXT.md: Deployment Task Dock Dismissal).
  assert.equal(countMatches(html, DISMISS_LABEL_GLOBAL_RE), 1);
});

test("deployment task dock row never renders cancel or redeploy actions", () => {
  const html = renderToStaticMarkup(
    <DeploymentTaskDockRow
      items={items}
      onDismiss={() => undefined}
      onOpen={() => undefined}
      visibleCount={3}
    />
  );

  assert.doesNotMatch(html, CANCEL_ACTION_RE);
  assert.doesNotMatch(html, REDEPLOY_ACTION_RE);
});

test("dock overflow panel lists every task with dock chip semantics", () => {
  const html = renderToStaticMarkup(
    <DeploymentTaskDockOverflowList
      onDismiss={() => undefined}
      onOpen={() => undefined}
      tasks={items}
    />
  );

  assert.match(html, LIST_SLOT_RE);
  assert.match(html, LIST_HEADING_RE);
  // The panel is the full task list, not just the hidden tail.
  assert.equal(countMatches(html, TASK_SLOT_GLOBAL_RE), items.length);
  // Chip rules carry over: dismiss only on the terminal (failed) row,
  // never cancel or redeploy (ADR 0038).
  assert.equal(countMatches(html, DISMISS_LABEL_GLOBAL_RE), 1);
  assert.doesNotMatch(html, CANCEL_ACTION_RE);
  assert.doesNotMatch(html, REDEPLOY_ACTION_RE);
});

test("deployment task dock is absent without tasks", () => {
  const html = renderToStaticMarkup(
    <ProjectCanvasDeploymentTaskDock
      dock={{ tasks: [] }}
      onDismiss={() => undefined}
      onOpen={() => undefined}
    />
  );

  assert.equal(html, "");
});

test("deployment task dock renders only the measuring host before layout", () => {
  const html = renderToStaticMarkup(
    <ProjectCanvasDeploymentTaskDock
      dock={{ tasks: items }}
      onDismiss={() => undefined}
      onOpen={() => undefined}
    />
  );

  // The visible count needs a real measured width; server markup carries
  // just the host so hydration never paints an unfitted row.
  assert.match(html, DOCK_SLOT_RE);
  assert.doesNotMatch(html, ROW_SLOT_RE);
});
