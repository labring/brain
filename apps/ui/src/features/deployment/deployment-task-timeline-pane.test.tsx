import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { DeploymentTaskTimelinePaneContent } from "./deployment-task-timeline-pane";

const TIMELINE_SLOT_RE = /data-slot="deployment-task-timeline"/;
const APPLY_EVENT_RE = /Applying deployment artifacts\./;
const RESULT_CARD_SLOT_RE = /data-slot="deployment-result-resource-card"/;
const API_RE = /api/;
const RUNNING_RE = /running/;
const REQUIRED_RE = /Required/;
const AP_READY_EVENT_RE = /AP workload has 1\/1 ready replicas\./;

test("deployment task timeline pane renders ordered steps, AP card, statuses, and grouped events", () => {
  const html = renderToStaticMarkup(
    <DeploymentTaskTimelinePaneContent
      snapshot={{
        events: [],
        task: {
          artifactSummary: {},
          blockingInputs: [],
          canvasProjection: {},
          completedAt: null,
          createdAt: "2026-06-17T10:00:00.000Z",
          createdFrom: "ui",
          error: null,
          gatewaySessionId: null,
          gatewayTurnId: null,
          gatewayUrl: null,
          id: "task-1",
          namespace: "default",
          phase: "apply",
          previewUrl: null,
          projectId: "project-1",
          projectName: "Project 1",
          resultUrl: null,
          runner: { kind: "direct" },
          runtimeName: null,
          runtimeProvider: null,
          runtimeState: null,
          source: { kind: "docker", settings: {} },
          startedAt: null,
          status: "applying",
          target: { kind: "existingProject", projectId: "project-1" },
          timelineSnapshot: null,
          updatedAt: "2026-06-17T10:00:01.000Z",
        },
        timeline: {
          revision: 4,
          status: "applying",
          steps: [
            {
              events: [
                {
                  createdAt: "2026-06-17T10:00:02.000Z",
                  id: "evt-2",
                  message: "Applying deployment artifacts.",
                  source: "runner",
                },
              ],
              id: "create-resources",
              label: "Create resources",
              order: 1,
              resultCards: [
                {
                  events: [
                    {
                      createdAt: "2026-06-17T10:00:03.000Z",
                      id: "evt-3",
                      message: "AP workload has 1/1 ready replicas.",
                      source: "resource-observer",
                    },
                  ],
                  id: "AP:default:api",
                  latestStatusText: "1/1 replicas ready",
                  required: true,
                  resultRef: { kind: "AP", name: "api", namespace: "default" },
                  status: "running",
                  title: "api",
                },
              ],
              status: "running",
            },
            {
              events: [],
              id: "validate-settings",
              label: "Validate settings",
              order: 0,
              status: "completed",
            },
          ],
          taskId: "task-1",
          updatedAt: "2026-06-17T10:00:03.000Z",
        },
      }}
    />
  );

  assert.match(html, TIMELINE_SLOT_RE);
  assert.ok(
    html.indexOf("Validate settings") < html.indexOf("Create resources")
  );
  assert.match(html, APPLY_EVENT_RE);
  assert.match(html, RESULT_CARD_SLOT_RE);
  assert.match(html, API_RE);
  assert.match(html, RUNNING_RE);
  assert.match(html, REQUIRED_RE);
  assert.match(html, AP_READY_EVENT_RE);
});
