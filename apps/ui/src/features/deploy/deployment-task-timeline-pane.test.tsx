import assert from "node:assert/strict";
import { test } from "node:test";
import { render } from "@testing-library/react/pure";
import { SidePane } from "@workspace/ui/components/side-pane";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DEPLOYMENT_TASK_SUCCESS_CELEBRATION_MS,
  deploymentTaskSuccessCelebrationKey,
  hasDeploymentTaskSuccessCelebrationClaim,
  resetDeploymentTaskSuccessCelebrationClaims,
} from "@/features/deploy/deployment-task-success-celebration";
import { deployTaskDevMockTask } from "@/features/deploy/task/dev-fixtures";
import { deploymentFailureMessage } from "@/features/deploy/task/failure-summary";
import type { DeploymentTaskSuccessSnapshot } from "@/features/deploy/task/timeline";
import type {
  DeploymentTaskTimelineSnapshotDTO,
  DeployTaskDTO,
  DeployTaskStatus,
} from "@/features/deploy/task/types";
import {
  actAndDrain,
  defineGlobal,
  installTestDom,
  restoreActEnvironment,
  restoreGlobal,
  setActEnvironment,
} from "@/features/project-canvas/react-test-harness";
import {
  DeploymentTaskTimelineActions,
  DeploymentTaskTimelinePane,
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
const PASSWORD_CONTROL_RE =
  /<input(?=[^>]*name="ai_gateway_api_key")(?=[^>]*type="password")[^>]*>/;
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
              options: ["generated-value"],
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
  assert.match(html, PASSWORD_CONTROL_RE);
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

test("deployment task lifecycle actions pin in the side pane footer slot", async () => {
  const dom = installTestDom();
  const previousActEnvironment = setActEnvironment(true);
  let rendered: ReturnType<typeof render> | undefined;
  try {
    await actAndDrain(() => {
      rendered = render(
        <SidePane
          label="Deployment task timeline pane"
          onClose={() => undefined}
          title="Deployment Timeline"
        >
          <p>Timeline steps</p>
          <DeploymentTaskTimelineActions
            kubeconfig="kubeconfig"
            namespace="default"
            task={actionsTask("failed")}
          />
        </SidePane>
      );
    });
    const container = rendered?.container;
    assert.ok(container);
    const footer = container.querySelector('[data-slot="side-pane-footer"]');
    assert.ok(footer, "the lifecycle action row opens the footer region");
    assert.ok(
      footer.querySelector('[data-slot="deployment-task-actions"]'),
      "the action row lands in the footer slot"
    );
    assert.equal(
      footer.closest(".overflow-y-auto"),
      null,
      "the footer stays outside the scroll container"
    );
  } finally {
    if (rendered) {
      await actAndDrain(() => {
        rendered?.unmount();
      });
    }
    restoreActEnvironment(previousActEnvironment);
    await dom.restore();
  }
});
/* -------------------------------------------------------------------------- */
/* Verified-success result card (issue #160)                                   */
/* -------------------------------------------------------------------------- */

const SUCCESS_SLOT_RE = /data-slot="deployment-task-success"/;
const SUCCESS_ENTRY_SLOT_RE = /data-slot="deployment-task-success-entry"/g;
const SUCCESS_VERIFICATION_SLOT_RE =
  /data-slot="deployment-task-success-verification"/;
const STEP_LABEL_RE = /Create resources/;
const CONFETTI_CANVAS_RE =
  /<canvas(?=[^>]*pointer-events-none)(?=[^>]*absolute inset-0)[^>]*data-slot="deployment-task-success-confetti"/;
// The canvas is mounted with the pane for as long as the pane lives, so only an
// active surface is evidence of a celebration.
const CELEBRATING_SURFACE_RE =
  /<canvas(?=[^>]*data-active="true")[^>]*data-slot="deployment-task-success-confetti"/;
const CELEBRATING_SURFACE_SELECTOR =
  '[data-slot="deployment-task-success-confetti"][data-active="true"]';
const FALLBACK_HEADLINE_RE = /You can start using it/;
const VIEW_DETAILS_RE = /View deployment details/;
const DECLARED_HEADLINE_RE = /Your server is online/;
const PRODUCT_NAME_RE = /EaglerCraft Server/;
const OPEN_SERVER_RE = /Open server/;
const CHECKS_PASSED_RE = /2\/2 checks passed/;
const VALIDATE_SETTINGS_RE = /Validate settings/;
const GUIDANCE_DETAIL_RE = /Keep it open in another tab\./;
const SERVER_ADDRESS_LABEL_RE = /Server address/;
const MULTIPLAYER_STEP_RE = /Go to Multiplayer and add a server\./;
const PLAY_STEP_RE = /Join the server and start playing\./;
const FIXTURE_ADDRESS_RE = /https:\/\/eaglercraft-server\.mock\.sealos\.run/;
const ORDERED_GUIDANCE_RE = /<ol/;
const DECLARED_ADDRESS_RE = /wss:/;
const PRIMARY_LINK_RE =
  /<a href="https:\/\/web-app\.demo\.sealos\.run"[^>]*>[\s\S]*?Open<\/a>/;
const ADDRESS_TEXT_RE =
  /<span class="truncate font-mono[^>]*title="https:\/\/web-app\.demo\.sealos\.run"/;

const VERIFIED_AT = "2026-06-17T10:00:05.000Z";

const SUCCESS_RECORD: DeploymentTaskSuccessSnapshot = {
  contractVersion: 1,
  entries: [
    { label: "Server address", url: "https://eaglercraft.demo.sealos.run" },
    { label: "Lobby", url: "https://lobby.demo.sealos.run" },
  ],
  guidance: [
    { detail: "Keep it open in another tab.", label: "Open the client." },
    { label: "Add the server in Multiplayer." },
  ],
  headline: "Your server is online",
  openActionLabel: "Open server",
  productName: "EaglerCraft Server",
  revision: 5,
  verification: { passed: 2, total: 2 },
  verifiedAt: VERIFIED_AT,
};

function successSnapshot(input: {
  runner?: DeployTaskDTO["runner"];
  source?: DeployTaskDTO["source"];
  status?: DeployTaskStatus;
  success?: DeploymentTaskSuccessSnapshot | null;
  taskId?: string;
}): DeploymentTaskTimelineSnapshotDTO {
  const status = input.status ?? "completed";
  const success = input.success === undefined ? SUCCESS_RECORD : input.success;
  const taskId = input.taskId ?? "task-success";
  return {
    events: [],
    task: {
      artifactSummary: {},
      blockingInputs: [],
      canvasProjection: {},
      completedAt: status === "completed" ? VERIFIED_AT : null,
      createdAt: "2026-06-17T10:00:00.000Z",
      createdFrom: "ui",
      error: null,
      failureDetails: null,
      gatewaySessionId: null,
      gatewayStateSnapshot: null,
      gatewayTurnId: null,
      gatewayUrl: null,
      id: taskId,
      namespace: "default",
      phase: status === "completed" ? "completed" : "verify",
      previewUrl: null,
      projectId: "project-1",
      projectName: "Project 1",
      resultUrl: success == null ? null : (success.entries?.[0]?.url ?? null),
      runner: input.runner ?? { kind: "direct" },
      runtimeName: null,
      runtimeProvider: null,
      runtimeState: null,
      source: input.source ?? { kind: "docker", settings: {} },
      startedAt: null,
      status,
      target: { kind: "existingProject", projectId: "project-1" },
      timelineSnapshot: null,
      updatedAt: VERIFIED_AT,
    },
    timeline: {
      revision: success?.revision ?? 4,
      status,
      steps: [
        {
          events: [],
          id: "create-resources",
          label: "Create resources",
          order: 1,
          status: "completed",
        },
        {
          events: [],
          id: "validate-settings",
          label: "Validate settings",
          order: 0,
          status: "completed",
        },
      ],
      ...(success == null ? {} : { success }),
      taskId,
      updatedAt: VERIFIED_AT,
    },
  };
}

function renderPaneContent(
  snapshot: DeploymentTaskTimelineSnapshotDTO
): string {
  return renderToStaticMarkup(
    <DeploymentTaskTimelinePaneContent
      kubeconfig="kubeconfig"
      namespace="default"
      snapshot={snapshot}
    />
  );
}

/**
 * Skips the celebration's *painting* for a mounted test: the result card's
 * static markup is what these tests read, and the browser canvas in this
 * harness has no 2D context. The reduced-motion path is covered in
 * deployment-task-success-confetti.test.tsx.
 */
function skipCelebrationPainting() {
  const override = defineGlobal("matchMedia", () => ({ matches: true }));
  return () => restoreGlobal(override);
}

/** The surfaces inside `root` that are throwing confetti right now. */
function celebratingSurfaces(root: ParentNode | null | undefined): Element[] {
  return root == null
    ? []
    : Array.from(root.querySelectorAll(CELEBRATING_SURFACE_SELECTOR));
}

test("a completed task without a verified record reports progress, not success", () => {
  const html = renderPaneContent(successSnapshot({ success: null }));

  assert.match(html, TIMELINE_SLOT_RE);
  assert.match(html, STEP_LABEL_RE);
  assert.doesNotMatch(html, SUCCESS_SLOT_RE);
  assert.doesNotMatch(html, FALLBACK_HEADLINE_RE);
  // Nothing collapsed the process away, so there is no details toggle either.
  assert.doesNotMatch(html, VIEW_DETAILS_RE);
});

test("a record attached before the task completed is not shown", () => {
  const html = renderPaneContent(successSnapshot({ status: "applying" }));

  assert.doesNotMatch(html, SUCCESS_SLOT_RE);
  assert.doesNotMatch(html, DECLARED_HEADLINE_RE);
});

test("the verified result takes the panel and keeps the process one click away", () => {
  const html = renderPaneContent(successSnapshot({}));

  assert.match(html, SUCCESS_SLOT_RE);
  assert.match(html, CONFETTI_CANVAS_RE);
  // A pane that opens straight onto a finished success reads the result; it
  // does not throw confetti at it.
  assert.doesNotMatch(html, CELEBRATING_SURFACE_RE);
  assert.match(html, DECLARED_HEADLINE_RE);
  assert.match(html, PRODUCT_NAME_RE);
  assert.doesNotMatch(html, FALLBACK_HEADLINE_RE);
  assert.match(html, OPEN_SERVER_RE);
  assert.match(html, VIEW_DETAILS_RE);
  assert.match(html, SUCCESS_VERIFICATION_SLOT_RE);
  assert.match(html, CHECKS_PASSED_RE);
  // Both declared addresses are listed, and the UI never builds one of its
  // own: the secondary address is only the element's own title and text node,
  // so it reads as an address to copy rather than a link to click.
  assert.equal((html.match(SUCCESS_ENTRY_SLOT_RE) ?? []).length, 2);
  assert.ok(
    html.includes(
      'title="https://lobby.demo.sealos.run">https://lobby.demo.sealos.run<'
    )
  );
  assert.equal(html.includes('href="https://lobby.demo.sealos.run"'), false);
  assert.ok(html.includes('href="https://eaglercraft.demo.sealos.run"'));
  assert.ok(html.includes('target="_blank"'));
  // Ordered first-use instructions, with their detail line.
  assert.ok(
    html.indexOf("Open the client.") <
      html.indexOf("Add the server in Multiplayer.")
  );
  assert.match(html, GUIDANCE_DETAIL_RE);
  // The steps are hidden behind the toggle but stay in the panel.
  assert.match(html, STEP_LABEL_RE);
  assert.match(html, VALIDATE_SETTINGS_RE);
  assert.ok(
    html.indexOf("Validate settings") < html.indexOf("Your server is online")
  );
});

test("a record that declares only an address still reads as a result", () => {
  const html = renderPaneContent(
    successSnapshot({
      success: {
        contractVersion: 1,
        entries: [{ url: "https://web-app.demo.sealos.run" }],
        revision: 3,
        verifiedAt: VERIFIED_AT,
      },
    })
  );

  assert.match(html, SUCCESS_SLOT_RE);
  assert.match(html, FALLBACK_HEADLINE_RE);
  assert.match(html, PRIMARY_LINK_RE);
  // The address is still listed as text next to the link.
  assert.match(html, ADDRESS_TEXT_RE);
  // No guidance was declared, so nothing is invented in its place.
  assert.doesNotMatch(html, ORDERED_GUIDANCE_RE);
});

test("the EaglerCraft fixture teaches a player how to join the server", () => {
  const snapshot = deployTaskDevMockTask("succeeded-eaglercraft", {
    namespace: "ns-demo",
    nowMs: Date.parse(VERIFIED_AT),
    projectId: "project-1",
  });
  assert.equal(snapshot.timeline.status, "completed");

  const html = renderPaneContent(snapshot);
  assert.match(html, DECLARED_HEADLINE_RE);
  assert.match(html, PRODUCT_NAME_RE);
  assert.match(html, OPEN_SERVER_RE);
  assert.match(html, SERVER_ADDRESS_LABEL_RE);
  assert.match(html, FIXTURE_ADDRESS_RE);
  assert.match(html, MULTIPLAYER_STEP_RE);
  assert.match(html, PLAY_STEP_RE);
  assert.match(html, CHECKS_PASSED_RE);
  // The fixture declares one http(s) address; the UI must not turn it into a
  // WebSocket endpoint on its own (that question is still open, issue #160).
  assert.doesNotMatch(html, DECLARED_ADDRESS_RE);
});

test("a success that arrives live celebrates once and stays readable", async () => {
  resetDeploymentTaskSuccessCelebrationClaims();
  const dom = installTestDom();
  const previousActEnvironment = setActEnvironment(true);
  const stopPainting = skipCelebrationPainting();
  let rendered: ReturnType<typeof render> | undefined;
  try {
    const show = async (snapshot: DeploymentTaskTimelineSnapshotDTO) => {
      await actAndDrain(() => {
        const element = (
          <DeploymentTaskTimelinePaneContent
            kubeconfig="kubeconfig"
            namespace="default"
            snapshot={snapshot}
          />
        );
        if (rendered == null) {
          rendered = render(element);
        } else {
          rendered.rerender(element);
        }
      });
    };
    const claim = deploymentTaskSuccessCelebrationKey(
      "task-success",
      SUCCESS_RECORD.revision
    );

    // The user is watching the last step finish, then the probes pass.
    await show(successSnapshot({ status: "applying", success: null }));
    await show(successSnapshot({}));
    assert.equal(hasDeploymentTaskSuccessCelebrationClaim(claim), true);
    assert.equal(
      celebratingSurfaces(rendered?.container).length,
      1,
      "this pane is the surface throwing the confetti"
    );
    assert.ok(
      rendered?.container.querySelector(
        '[data-slot="deployment-task-success"]'
      ),
      "the result is readable while it celebrates"
    );
    // A duplicate frame of the same conclusion must not extend the window.
    await show(successSnapshot({}));

    await actAndDrain(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, DEPLOYMENT_TASK_SUCCESS_CELEBRATION_MS + 150);
      });
    });
    assert.equal(celebratingSurfaces(rendered?.container).length, 0);
    assert.ok(
      rendered?.container.querySelector(
        '[data-slot="deployment-task-success"]'
      ),
      "the result stays readable after the celebration ends"
    );

    // Later stream ticks replaying the same success never restart the party.
    await show(successSnapshot({}));
    await actAndDrain(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 120);
      });
    });
    assert.equal(celebratingSurfaces(rendered?.container).length, 0);
  } finally {
    if (rendered) {
      await actAndDrain(() => {
        rendered?.unmount();
      });
    }
    restoreActEnvironment(previousActEnvironment);
    stopPainting();
    await dom.restore();
    resetDeploymentTaskSuccessCelebrationClaims();
  }
});

test("a live success stops celebrating without closing the Timeline pane", async () => {
  resetDeploymentTaskSuccessCelebrationClaims();
  const dom = installTestDom();
  const previousActEnvironment = setActEnvironment(true);
  const stopPainting = skipCelebrationPainting();
  const initial = successSnapshot({ status: "applying", success: null });
  const succeeded = successSnapshot({});
  const encoder = new TextEncoder();
  let closeRequests = 0;
  let publishSuccess: (() => void) | undefined;
  let rendered: ReturnType<typeof render> | undefined;
  const fetchOverride = defineGlobal(
    "fetch",
    (input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).includes("/stream")) {
        return Promise.resolve(Response.json(initial));
      }
      return Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              publishSuccess = () => {
                controller.enqueue(
                  encoder.encode(
                    `event: update\ndata: ${JSON.stringify({ snapshot: succeeded, type: "update" })}\n\n`
                  )
                );
              };
              init?.signal?.addEventListener(
                "abort",
                () => controller.close(),
                {
                  once: true,
                }
              );
            },
          }),
          { headers: { "Content-Type": "text/event-stream" } }
        )
      );
    }
  );
  try {
    await actAndDrain(() => {
      rendered = render(
        <DeploymentTaskTimelinePane
          kubeconfig="kubeconfig"
          namespace="default"
          onClose={() => {
            closeRequests += 1;
          }}
          taskId="task-success"
        />
      );
    });
    assert.equal(
      rendered?.container.querySelector(
        '[data-slot="deployment-task-success"]'
      ),
      null
    );
    assert.ok(publishSuccess, "the Timeline stream is connected");
    await actAndDrain(() => {
      publishSuccess?.();
    }, 250);
    await actAndDrain(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, DEPLOYMENT_TASK_SUCCESS_CELEBRATION_MS + 500);
      });
    });

    assert.equal(closeRequests, 0);
    assert.ok(
      rendered?.container.querySelector(
        '[data-slot="deployment-task-success"]'
      ),
      "the verified result stays readable until the user closes the pane"
    );
  } finally {
    if (rendered) {
      await actAndDrain(() => {
        rendered?.unmount();
      });
    }
    restoreGlobal(fetchOverride);
    restoreActEnvironment(previousActEnvironment);
    stopPainting();
    await dom.restore();
    resetDeploymentTaskSuccessCelebrationClaims();
  }
});

test("a pane opened on a finished task does not celebrate", async () => {
  resetDeploymentTaskSuccessCelebrationClaims();
  const dom = installTestDom();
  const previousActEnvironment = setActEnvironment(true);
  const stopPainting = skipCelebrationPainting();
  let rendered: ReturnType<typeof render> | undefined;
  try {
    await actAndDrain(() => {
      rendered = render(
        <DeploymentTaskTimelinePaneContent
          kubeconfig="kubeconfig"
          namespace="default"
          snapshot={successSnapshot({})}
        />
      );
    });
    assert.ok(
      rendered?.container.querySelector(
        '[data-slot="deployment-task-success"]'
      ),
      "the result is still readable after a refresh"
    );
    await actAndDrain(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, DEPLOYMENT_TASK_SUCCESS_CELEBRATION_MS + 150);
      });
    });
    assert.equal(celebratingSurfaces(rendered?.container).length, 0);
    assert.equal(
      hasDeploymentTaskSuccessCelebrationClaim(
        deploymentTaskSuccessCelebrationKey(
          "task-success",
          SUCCESS_RECORD.revision
        )
      ),
      false
    );
  } finally {
    if (rendered) {
      await actAndDrain(() => {
        rendered?.unmount();
      });
    }
    restoreActEnvironment(previousActEnvironment);
    stopPainting();
    await dom.restore();
    resetDeploymentTaskSuccessCelebrationClaims();
  }
});

test("the result is scrolled into view when it lands", async () => {
  resetDeploymentTaskSuccessCelebrationClaims();
  const dom = installTestDom();
  const previousActEnvironment = setActEnvironment(true);
  const stopPainting = skipCelebrationPainting();
  const previousScrollIntoView = Element.prototype.scrollIntoView;
  const scrolledBlocks: string[] = [];
  Element.prototype.scrollIntoView = function scroll(
    this: Element,
    options?: boolean | ScrollIntoViewOptions
  ) {
    scrolledBlocks.push(
      typeof options === "object" && options != null
        ? String(options.block)
        : "default"
    );
  };
  let rendered: ReturnType<typeof render> | undefined;
  try {
    const show = async (snapshot: DeploymentTaskTimelineSnapshotDTO) => {
      await actAndDrain(() => {
        const element = (
          <DeploymentTaskTimelinePaneContent
            kubeconfig="kubeconfig"
            namespace="default"
            snapshot={snapshot}
          />
        );
        if (rendered == null) {
          rendered = render(element);
        } else {
          rendered.rerender(element);
        }
      });
    };

    // The steps above are the process and this is the answer, so the result
    // has to come into view instead of waiting below the fold.
    await show(successSnapshot({ status: "applying", success: null }));
    assert.deepEqual(scrolledBlocks, []);
    await show(successSnapshot({}));
    assert.deepEqual(scrolledBlocks, ["nearest"]);
    // A duplicate frame of the same conclusion is not a new arrival.
    await show(successSnapshot({}));
    assert.deepEqual(scrolledBlocks, ["nearest"]);
  } finally {
    Element.prototype.scrollIntoView = previousScrollIntoView;
    if (rendered) {
      await actAndDrain(() => {
        rendered?.unmount();
      });
    }
    restoreActEnvironment(previousActEnvironment);
    stopPainting();
    await dom.restore();
    resetDeploymentTaskSuccessCelebrationClaims();
  }
});

test("only the pane that watched the success land celebrates it", async () => {
  resetDeploymentTaskSuccessCelebrationClaims();
  const dom = installTestDom();
  const previousActEnvironment = setActEnvironment(true);
  const stopPainting = skipCelebrationPainting();
  const panes: ReturnType<typeof render>[] = [];
  const paneFor = (snapshot: DeploymentTaskTimelineSnapshotDTO) => (
    <DeploymentTaskTimelinePaneContent
      kubeconfig="kubeconfig"
      namespace="default"
      snapshot={snapshot}
    />
  );
  try {
    await actAndDrain(() => {
      for (let index = 0; index < 2; index += 1) {
        panes.push(
          render(
            paneFor(successSnapshot({ status: "applying", success: null }))
          )
        );
      }
    });
    await actAndDrain(() => {
      for (const pane of panes) {
        pane.rerender(paneFor(successSnapshot({})));
      }
    });

    // Reading an open window is not the same as owning one: another surface
    // for the same success must not get its own layer of confetti.
    assert.equal(
      celebratingSurfaces(document).length,
      1,
      "the whole page celebrates exactly once"
    );

    await actAndDrain(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, DEPLOYMENT_TASK_SUCCESS_CELEBRATION_MS + 150);
      });
    });
    assert.equal(celebratingSurfaces(document).length, 0);
  } finally {
    await actAndDrain(() => {
      for (const pane of panes) {
        pane.unmount();
      }
    });
    restoreActEnvironment(previousActEnvironment);
    stopPainting();
    await dom.restore();
    resetDeploymentTaskSuccessCelebrationClaims();
  }
});
