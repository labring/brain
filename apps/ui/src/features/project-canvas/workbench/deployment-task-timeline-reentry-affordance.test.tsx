import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { DeploymentTaskTimelineReentry } from "./deployment-task-timeline-reentry";
import { ProjectCanvasDeploymentTaskTimelineReentryAffordance } from "./deployment-task-timeline-reentry-affordance";

const REENTRY_SLOT_RE = /data-slot="deployment-task-timeline-reentry"/;
const OPEN_BUTTON_RE = /Open timeline/;
const DISMISS_LABEL_RE = /Dismiss deployment timeline re-entry/;
const TASK_ID_RE = /task-blocked/;

const reentry: DeploymentTaskTimelineReentry = {
  label: "Deployment blocked",
  task: {
    artifactSummary: {},
    canvasProjection: {},
    completedAt: null,
    id: "task-blocked",
    namespace: "default",
    phase: "apply",
    projectId: "project-1",
    status: "blocked",
    updatedAt: "2026-06-17T10:02:00.000Z",
  },
};

test("deployment task timeline re-entry affordance renders open and dismiss actions", () => {
  const html = renderToStaticMarkup(
    <ProjectCanvasDeploymentTaskTimelineReentryAffordance
      onDismiss={() => undefined}
      onOpen={() => undefined}
      reentry={reentry}
    />
  );

  assert.match(html, REENTRY_SLOT_RE);
  assert.match(html, OPEN_BUTTON_RE);
  assert.match(html, DISMISS_LABEL_RE);
  assert.match(html, TASK_ID_RE);
});

test("deployment task timeline re-entry affordance is absent without a task", () => {
  const html = renderToStaticMarkup(
    <ProjectCanvasDeploymentTaskTimelineReentryAffordance
      onDismiss={() => undefined}
      onOpen={() => undefined}
      reentry={null}
    />
  );

  assert.equal(html, "");
});
