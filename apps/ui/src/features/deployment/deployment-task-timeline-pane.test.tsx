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
const OPTIONAL_RE = /Optional/;
const AP_READY_EVENT_RE = /AP workload has 1\/1 ready replicas\./;
const PUBLIC_ACCESS_LABEL_RE = /Public access/;
const PUBLIC_ACCESS_ENUM_RE = /PublicAccess/;
const PUBLIC_ADDRESS_ACCESSIBLE_RE = /Public Address is accessible\./;
const RESOURCE_CARD_COLLAPSED_RE = /aria-expanded="false"/;
const ANALYZE_REQUEST_RE = /Analyze request/;
const SKIPPED_RE = /skipped/;

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
                {
                  events: [
                    {
                      createdAt: "2026-06-17T10:00:04.000Z",
                      id: "evt-4",
                      message: "Public Address is accessible.",
                      severity: "success",
                      source: "resource-observer",
                    },
                  ],
                  id: "PublicAccess:default:api:pa_api",
                  latestStatusText: "accessible",
                  required: false,
                  resultRef: {
                    apName: "api",
                    id: "pa_api",
                    kind: "PublicAccess",
                    namespace: "default",
                  },
                  status: "running",
                  title: "Public access",
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
  assert.match(html, OPTIONAL_RE);
  assert.match(html, AP_READY_EVENT_RE);
  assert.match(html, PUBLIC_ACCESS_LABEL_RE);
  assert.doesNotMatch(html, PUBLIC_ACCESS_ENUM_RE);
  assert.match(html, PUBLIC_ADDRESS_ACCESSIBLE_RE);
  assert.match(html, RESOURCE_CARD_COLLAPSED_RE);
});

test("deployment task timeline pane renders skipped runner steps", () => {
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
          id: "task-2",
          namespace: "default",
          phase: "generate-artifacts",
          previewUrl: null,
          projectId: "project-1",
          projectName: "Project 1",
          resultUrl: null,
          runner: { kind: "ai", runtimeProvider: "devbox" },
          runtimeName: null,
          runtimeProvider: null,
          runtimeState: null,
          source: { kind: "prompt", text: "Deploy a tiny app" },
          startedAt: null,
          status: "running",
          target: { kind: "existingProject", projectId: "project-1" },
          timelineSnapshot: null,
          updatedAt: "2026-06-17T10:00:01.000Z",
        },
        timeline: {
          revision: 2,
          status: "running",
          steps: [
            {
              events: [],
              id: "analyze-source",
              label: "Analyze request",
              order: 1,
              status: "skipped",
            },
          ],
          taskId: "task-2",
          updatedAt: "2026-06-17T10:00:01.000Z",
        },
      }}
    />
  );

  assert.match(html, ANALYZE_REQUEST_RE);
  assert.match(html, SKIPPED_RE);
});
