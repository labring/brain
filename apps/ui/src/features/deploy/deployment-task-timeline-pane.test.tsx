import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { deploymentFailureMessage } from "@/features/deploy/task/failure-summary";
import type { DeployTaskDTO } from "@/features/deploy/task/types";
import {
  DeploymentTaskTimelineActions,
  DeploymentTaskTimelinePaneContent,
} from "./deployment-task-timeline-pane";

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
const DEPLOYMENT_CONFIGURATION_RE = /Deployment configuration/;
const AI_GATEWAY_KEY_RE = /AI Gateway API key/;
const DEPLOYMENT_REGION_RE = /Deployment region/;
const CHOICE_CONTROL_RE = /role="combobox"/;
const CONTINUE_DEPLOYMENT_RE = /Continue Deployment/;
const FIRECRAWL_API_KEY_RE = /FIRECRAWL_API_KEY/;
const FIRECRAWL_API_KEY_DESCRIPTION_RE = /FIRECRAWL API KEY\./;
const FIRECRAWL_API_KEY_INPUT_NAME_RE = /name="FIRECRAWL_API_KEY"/;
const TIMELINE_DESIGN_CARD_STYLE_RE =
  /relative overflow-hidden rounded-lg bg-white\/\[0\.05\]/;
const TIMELINE_BORDER_BEAM_RE = /deployment-timeline-border-beam/;
const PRIVATE_GATEWAY_STDERR_RE = /some private gateway stderr/;
const AI_FAILURE_ACTION_RE = /deployment analysis service returned an error/i;
const TIMELINE_BASE_BORDER_RE =
  /pointer-events-none absolute inset-px rounded-\[calc\(var\(--radius-lg\)-1px\)\] border/;
const DEPLOYMENT_CONFIGURATION_CARD_STYLE_RE =
  /overflow-hidden rounded-lg border border-border bg-input\/30/;
const AMBER_FORM_BACKGROUND_RE = /bg-amber-500\/10/;
const DEPLOYMENT_CONFIGURATION_FORM_RE =
  /<form[^>]*data-slot="deployment-configuration-form"[^>]*>(.*?)<\/form>/;
const TASK_ID_ROW_SLOT_RE = /data-slot="deployment-task-id"/;
const TASK_ID_LABEL_RE = /Task ID:/;
const TASK_ID_VALUE_RE = /task-1/;
const TASK_ID_COPY_BUTTON_RE = /aria-label="Copy task ID"/;
const APPLY_EVENT_CREATED_AT = "2026-06-17T10:00:02.000Z";
const AP_READY_EVENT_CREATED_AT = "2026-06-17T10:00:03.000Z";
const RAW_EVENT_TIME_AS_TEXT_RE = />2026-06-17T10:00:0[234]\.000Z</;

const TIMELINE_EVENT_TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  hour12: false,
  minute: "2-digit",
});

function deploymentConfigurationFormHtml(html: string): string {
  return html.match(DEPLOYMENT_CONFIGURATION_FORM_RE)?.[1] ?? "";
}

function timelineEventTime(value: string): string {
  return TIMELINE_EVENT_TIME_FORMAT.format(new Date(Date.parse(value)));
}

function timelineEventTimeTitleRe(value: string): RegExp {
  return new RegExp(`title="${value}">${timelineEventTime(value)}</span>`);
}

test("deployment task timeline pane renders ordered steps, AP card, statuses, and grouped events", () => {
  const html = renderToStaticMarkup(
    <DeploymentTaskTimelinePaneContent
      kubeconfig="kubeconfig"
      namespace="default"
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
          failureDetails: null,
          gatewayStateSnapshot: null,
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
                  createdAt: APPLY_EVENT_CREATED_AT,
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
                      createdAt: AP_READY_EVENT_CREATED_AT,
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
  assert.match(html, TASK_ID_ROW_SLOT_RE);
  assert.match(html, TASK_ID_LABEL_RE);
  assert.match(html, TASK_ID_VALUE_RE);
  assert.match(html, TASK_ID_COPY_BUTTON_RE);
  assert.ok(
    html.indexOf('data-slot="deployment-task-id"') <
      html.indexOf("Validate settings")
  );
  assert.ok(
    html.indexOf("Validate settings") < html.indexOf("Create resources")
  );
  assert.match(html, APPLY_EVENT_RE);
  assert.match(html, timelineEventTimeTitleRe(APPLY_EVENT_CREATED_AT));
  assert.match(html, RESULT_CARD_SLOT_RE);
  assert.match(html, API_RE);
  assert.match(html, RUNNING_RE);
  assert.match(html, REQUIRED_RE);
  assert.match(html, OPTIONAL_RE);
  assert.match(html, AP_READY_EVENT_RE);
  assert.match(html, timelineEventTimeTitleRe(AP_READY_EVENT_CREATED_AT));
  assert.doesNotMatch(html, RAW_EVENT_TIME_AS_TEXT_RE);
  assert.match(html, PUBLIC_ACCESS_LABEL_RE);
  assert.doesNotMatch(html, PUBLIC_ACCESS_ENUM_RE);
  assert.match(html, PUBLIC_ADDRESS_ACCESSIBLE_RE);
  assert.match(html, RESOURCE_CARD_COLLAPSED_RE);
});

test("deployment task timeline pane renders skipped runner steps", () => {
  const html = renderToStaticMarkup(
    <DeploymentTaskTimelinePaneContent
      kubeconfig="kubeconfig"
      namespace="default"
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
          failureDetails: null,
          gatewayStateSnapshot: null,
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

test("deployment task timeline pane renders template input form when blocked", () => {
  const html = renderToStaticMarkup(
    <DeploymentTaskTimelinePaneContent
      kubeconfig="kubeconfig"
      namespace="default"
      snapshot={{
        events: [],
        task: {
          artifactSummary: {
            deploymentPlan: {
              inputs: [
                {
                  description: "API key for the gateway",
                  key: "ai_gateway_api_key",
                  label: "AI Gateway API key",
                  required: true,
                  sensitive: true,
                  type: "secret",
                },
                {
                  default: "us-west-1",
                  description: "Region for the deployment",
                  key: "deployment_region",
                  label: "Deployment region",
                  options: ["us-west-1", "us-east-1"],
                  required: true,
                  type: "choice",
                },
              ],
              kind: "sealos-template",
              missingInputKeys: ["ai_gateway_api_key", "deployment_region"],
              templateName: "ai-gateway",
            },
          },
          blockingInputs: [
            {
              id: "ai_gateway_api_key",
              label: "AI Gateway API key",
              required: true,
              type: "secret",
            },
            {
              defaultValue: "us-west-1",
              description: "Region for the deployment",
              id: "deployment_region",
              key: "deployment_region",
              label: "Deployment region",
              options: ["us-west-1", "us-east-1"],
              required: true,
              type: "text",
              valueType: "choice",
            },
          ],
          canvasProjection: {},
          completedAt: null,
          createdAt: "2026-06-17T10:00:00.000Z",
          createdFrom: "ui",
          error: null,
          gatewaySessionId: null,
          failureDetails: null,
          gatewayStateSnapshot: null,
          gatewayTurnId: null,
          gatewayUrl: null,
          id: "task-3",
          namespace: "default",
          phase: "configure",
          previewUrl: null,
          projectId: "project-1",
          projectName: "Project 1",
          resultUrl: null,
          runner: { kind: "ai", runtimeProvider: "devbox" },
          runtimeName: null,
          runtimeProvider: null,
          runtimeState: null,
          source: { kind: "prompt", text: "Deploy" },
          startedAt: null,
          status: "blocked",
          target: { kind: "existingProject", projectId: "project-1" },
          timelineSnapshot: null,
          updatedAt: "2026-06-17T10:00:01.000Z",
        },
        timeline: {
          revision: 1,
          status: "blocked",
          steps: [
            {
              events: [],
              id: "generate-deployment",
              label: "Generate deployment",
              order: 2,
              status: "blocked",
            },
          ],
          taskId: "task-3",
          updatedAt: "2026-06-17T10:00:01.000Z",
        },
      }}
    />
  );

  assert.match(html, DEPLOYMENT_CONFIGURATION_RE);
  assert.match(html, AI_GATEWAY_KEY_RE);
  assert.match(html, DEPLOYMENT_REGION_RE);
  assert.match(html, CHOICE_CONTROL_RE);
  assert.match(html, CONTINUE_DEPLOYMENT_RE);
  assert.match(html, TIMELINE_DESIGN_CARD_STYLE_RE);
  assert.match(html, TIMELINE_BORDER_BEAM_RE);
  assert.match(html, TIMELINE_BASE_BORDER_RE);
  assert.match(html, DEPLOYMENT_CONFIGURATION_CARD_STYLE_RE);
  assert.doesNotMatch(
    deploymentConfigurationFormHtml(html),
    AMBER_FORM_BACKGROUND_RE
  );
  assert.ok(
    html.indexOf("Generate deployment") <
      html.indexOf("Deployment configuration")
  );
});

test("deployment task timeline pane restores form from blocking inputs after refresh", () => {
  const html = renderToStaticMarkup(
    <DeploymentTaskTimelinePaneContent
      kubeconfig="kubeconfig"
      namespace="default"
      snapshot={{
        events: [],
        task: {
          artifactSummary: {
            deploymentPlan: {
              inputs: [],
              kind: "sealos-template",
              missingInputKeys: ["firecrawl_api_key"],
              templateName: "open-lovable",
            },
          },
          blockingInputs: [
            {
              description: "FIRECRAWL API KEY.",
              id: "firecrawl_api_key",
              key: "FIRECRAWL_API_KEY",
              label: "FIRECRAWL_API_KEY",
              required: true,
              sensitive: true,
              type: "secret",
            },
          ],
          canvasProjection: {},
          completedAt: null,
          createdAt: "2026-06-17T10:00:00.000Z",
          createdFrom: "ui",
          error: null,
          gatewaySessionId: null,
          failureDetails: null,
          gatewayStateSnapshot: null,
          gatewayTurnId: null,
          gatewayUrl: null,
          id: "task-4",
          namespace: "default",
          phase: "configure",
          previewUrl: null,
          projectId: "project-1",
          projectName: "Project 1",
          resultUrl: null,
          runner: { kind: "ai", runtimeProvider: "devbox" },
          runtimeName: null,
          runtimeProvider: null,
          runtimeState: null,
          source: {
            kind: "github",
            repo: {
              fullName: "zjy/open-lovable",
              name: "open-lovable",
              url: "https://github.com/zjy/open-lovable",
            },
          },
          startedAt: null,
          status: "blocked",
          target: { kind: "existingProject", projectId: "project-1" },
          timelineSnapshot: null,
          updatedAt: "2026-06-17T10:00:01.000Z",
        },
        timeline: {
          revision: 1,
          status: "blocked",
          steps: [
            {
              events: [],
              id: "generate-deployment",
              label: "Generate deployment",
              order: 2,
              status: "blocked",
            },
          ],
          taskId: "task-4",
          updatedAt: "2026-06-17T10:00:01.000Z",
        },
      }}
    />
  );

  assert.match(html, DEPLOYMENT_CONFIGURATION_RE);
  assert.match(html, FIRECRAWL_API_KEY_RE);
  assert.match(html, FIRECRAWL_API_KEY_DESCRIPTION_RE);
  assert.match(html, FIRECRAWL_API_KEY_INPUT_NAME_RE);
});

test("deployment task timeline pane keeps failed tasks form-free (blocked is the only waiting state)", () => {
  const html = renderToStaticMarkup(
    <DeploymentTaskTimelinePaneContent
      kubeconfig="kubeconfig"
      namespace="default"
      snapshot={{
        events: [],
        task: {
          artifactSummary: {
            deploymentPlan: {
              inputs: [
                {
                  description: "FIRECRAWL API KEY.",
                  key: "FIRECRAWL_API_KEY",
                  required: true,
                  sensitive: true,
                  type: "string",
                },
              ],
              kind: "sealos-template",
              missingInputKeys: ["FIRECRAWL_API_KEY"],
              templateName: "open-lovable",
            },
          },
          blockingInputs: [],
          canvasProjection: {},
          completedAt: "2026-06-18T07:32:22.281Z",
          createdAt: "2026-06-17T10:00:00.000Z",
          createdFrom: "ui",
          error:
            "Sealos template workload image does not match the succeeded build image.",
          failureDetails: null,
          gatewaySessionId: null,
          gatewayStateSnapshot: null,
          gatewayTurnId: null,
          gatewayUrl: null,
          id: "task-5",
          namespace: "default",
          phase: "configure",
          previewUrl: null,
          projectId: "project-1",
          projectName: "Project 1",
          resultUrl: null,
          runner: { kind: "ai", runtimeProvider: "devbox" },
          runtimeName: null,
          runtimeProvider: null,
          runtimeState: null,
          source: {
            kind: "github",
            repo: {
              fullName: "zjy/open-lovable",
              name: "open-lovable",
              url: "https://github.com/zjy/open-lovable",
            },
          },
          startedAt: null,
          status: "failed",
          target: { kind: "existingProject", projectId: "project-1" },
          timelineSnapshot: null,
          updatedAt: "2026-06-18T07:32:22.614Z",
        },
        timeline: {
          revision: 1,
          status: "failed",
          steps: [
            {
              events: [],
              id: "generate-deployment",
              label: "Generate deployment",
              order: 2,
              status: "blocked",
            },
          ],
          taskId: "task-5",
          updatedAt: "2026-06-18T07:32:22.614Z",
        },
      }}
    />
  );

  // Failed is a pure terminal status (ADR 0038): recovery is Redeploy, so
  // the input form never renders on a failed task.
  assert.doesNotMatch(html, DEPLOYMENT_CONFIGURATION_RE);
});

const FAILURE_DETAIL_SLOT_RE = /data-slot="deployment-failure-detail"/;
const SHOW_ERROR_DETAILS_RE = /Show error details/;

function failedSnapshot(
  runner: DeployTaskDTO["runner"],
  error: string
): Parameters<typeof DeploymentTaskTimelinePaneContent>[0]["snapshot"] {
  return {
    events: [],
    task: {
      artifactSummary: {},
      blockingInputs: [],
      canvasProjection: {},
      completedAt: "2026-06-18T07:32:22.281Z",
      createdAt: "2026-06-17T10:00:00.000Z",
      createdFrom: "ui",
      error,
      failureDetails:
        runner.kind === "ai"
          ? { httpStatus: 503, reason: "gateway-upstream-error" }
          : null,
      gatewaySessionId: null,
      gatewayStateSnapshot: null,
      gatewayTurnId: null,
      gatewayUrl: null,
      id: "task-fail",
      namespace: "default",
      phase: "generate-artifacts",
      previewUrl: null,
      projectId: "project-1",
      projectName: "Project 1",
      resultUrl: null,
      runner,
      runtimeName: null,
      runtimeProvider: null,
      runtimeState: null,
      source: { kind: "template", templateName: "open-lovable" },
      startedAt: null,
      status: "failed",
      target: { kind: "existingProject", projectId: "project-1" },
      timelineSnapshot: null,
      updatedAt: "2026-06-18T07:32:22.614Z",
    },
    timeline: {
      revision: 1,
      status: "failed",
      steps: [
        {
          events: [
            {
              createdAt: "2026-06-17T10:00:02.000Z",
              id: "evt-fail",
              message:
                runner.kind === "ai"
                  ? deploymentFailureMessage("gateway-upstream-error")
                  : "The deployment values were rejected as invalid.",
              severity: "error",
            },
          ],
          id: "prepare-template",
          label: "Prepare template",
          order: 0,
          status: "failed",
        },
      ],
      taskId: "task-fail",
      updatedAt: "2026-06-18T07:32:22.614Z",
    },
  };
}

test("surfaces a failure-detail affordance under a failed template step", () => {
  const html = renderToStaticMarkup(
    <DeploymentTaskTimelinePaneContent
      kubeconfig="kubeconfig"
      namespace="default"
      snapshot={failedSnapshot(
        { kind: "template" },
        'instances.app "open-lovable" already exists'
      )}
    />
  );

  assert.match(html, FAILURE_DETAIL_SLOT_RE);
  assert.match(html, SHOW_ERROR_DETAILS_RE);
});

test("shows only allowlisted failure detail for the AI runner", () => {
  const html = renderToStaticMarkup(
    <DeploymentTaskTimelinePaneContent
      kubeconfig="kubeconfig"
      namespace="default"
      snapshot={failedSnapshot(
        { kind: "ai", runtimeProvider: "devbox" },
        "some private gateway stderr"
      )}
    />
  );

  assert.match(html, FAILURE_DETAIL_SLOT_RE);
  assert.match(html, SHOW_ERROR_DETAILS_RE);
  assert.match(html, AI_FAILURE_ACTION_RE);
  assert.doesNotMatch(html, PRIVATE_GATEWAY_STDERR_RE);
});

const CANCEL_DEPLOYMENT_RE = /Cancel Deployment/;
const REDEPLOY_RE = /Redeploy/;
const DISABLED_ATTR_RE = / disabled=""/g;
const CANCEL_DIALOG_SLOT_RE = /data-slot="deployment-task-cancel-dialog"/;

function actionsTask(status: DeployTaskDTO["status"]): DeployTaskDTO {
  return {
    artifactSummary: {},
    blockingInputs: [],
    canvasProjection: {},
    completedAt: null,
    createdAt: "2026-06-17T10:00:00.000Z",
    createdFrom: "ui",
    error: null,
    failureDetails: null,
    gatewaySessionId: null,
    gatewayStateSnapshot: null,
    gatewayTurnId: null,
    gatewayUrl: null,
    id: "task-actions",
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
    status,
    target: { kind: "existingProject", projectId: "project-1" },
    timelineSnapshot: null,
    updatedAt: "2026-06-17T10:00:01.000Z",
  };
}

function renderActions(status: DeployTaskDTO["status"]): string {
  return renderToStaticMarkup(
    <DeploymentTaskTimelineActions
      kubeconfig="kubeconfig"
      namespace="default"
      task={actionsTask(status)}
    />
  );
}

test("deployment task timeline actions keep cancel visible but disabled on terminal statuses", () => {
  const running = renderActions("running");
  assert.match(running, CANCEL_DEPLOYMENT_RE);
  assert.equal((running.match(DISABLED_ATTR_RE) ?? []).length, 0);
  assert.doesNotMatch(running, REDEPLOY_RE);

  const completed = renderActions("completed");
  assert.match(completed, CANCEL_DEPLOYMENT_RE);
  assert.equal((completed.match(DISABLED_ATTR_RE) ?? []).length, 1);
  assert.doesNotMatch(completed, REDEPLOY_RE);

  const failed = renderActions("failed");
  assert.match(failed, CANCEL_DEPLOYMENT_RE);
  assert.match(failed, REDEPLOY_RE);
  // Cancel is the one disabled control; Redeploy stays actionable.
  assert.equal((failed.match(DISABLED_ATTR_RE) ?? []).length, 1);
  // The confirm dialog only mounts after a click on the enabled button.
  assert.doesNotMatch(failed, CANCEL_DIALOG_SLOT_RE);
});
