import { resolveDevMock } from "@/features/dev-mock/server/resolve";
import { MINUTE_MS } from "@/lib/time";

import {
  type DeployTaskDevScenario,
  deployTaskDevMockCookie,
  deployTaskDevMockTaskId,
} from "./dev-mock-cookie";
import type { DeploymentTaskProjection } from "./projection";
import type { DeployTaskStatus } from "./schema";
import {
  DEPLOYMENT_TASK_TERMINAL_FAILURE_EVENT_KEY,
  type DeploymentResultResourceCard,
  type DeploymentTaskTimelineSnapshot,
  type DeploymentTimelineEvent,
  type DeploymentTimelineStep,
  type DeploymentTimelineStepStatus,
} from "./timeline";
import type {
  DeploymentTaskTimelineSnapshotDTO,
  DeploymentTaskTimelineStreamEvent,
  DeployTaskDTO,
  DeployTaskEventDTO,
} from "./types";

/**
 * Deployment Task Timeline dev fixtures: one AI-runner task per scenario,
 * deploying `acme/web-app` into the open Project. The timeline route and its
 * SSE stream answer for the fixture task id; the task list and projection
 * stream answer with the fixture alone so the Deployment Task Dock shows
 * its chip. Timestamps are relative to the request so completion windows
 * (canvas placeholder, dock notice) behave as they would live. Static: the
 * stream sends the snapshot once and then only heartbeats.
 */

const SECOND_MS = 1000;
const PROJECT_NAME = "web-app";
const REPO = "acme/web-app";

interface FixtureClock {
  at(offsetMs: number): string;
  nowMs: number;
}

function clock(nowMs: number): FixtureClock {
  return { at: (offsetMs) => new Date(nowMs + offsetMs).toISOString(), nowMs };
}

function event(
  time: FixtureClock,
  offsetMs: number,
  id: string,
  message: string,
  extra: Partial<DeploymentTimelineEvent> = {}
): DeploymentTimelineEvent {
  return {
    createdAt: time.at(offsetMs),
    id,
    message,
    source: "runner",
    ...extra,
  };
}

function step(
  id: string,
  label: string,
  order: number,
  status: DeploymentTimelineStepStatus,
  events: DeploymentTimelineEvent[],
  resultCards?: DeploymentResultResourceCard[]
): DeploymentTimelineStep {
  return {
    events,
    id,
    label,
    order,
    ...(resultCards == null ? {} : { resultCards }),
    status,
  };
}

function resultCards(
  time: FixtureClock,
  namespace: string,
  phase: "creating" | "ready"
): DeploymentResultResourceCard[] {
  const ready = phase === "ready";
  return [
    {
      events: [
        event(
          time,
          ready ? -40 * SECOND_MS : -20 * SECOND_MS,
          "evt-ap",
          ready
            ? "AP workload has 1/1 ready replicas."
            : "AP workload is starting; 0/1 replicas ready.",
          {
            source: "resource-observer",
            ...(ready ? { severity: "success" } : {}),
          }
        ),
      ],
      id: `AP:${namespace}:${PROJECT_NAME}`,
      latestStatusText: ready ? "1/1 replicas ready" : "0/1 replicas ready",
      required: true,
      resultRef: { kind: "AP", name: PROJECT_NAME, namespace },
      status: ready ? "running" : "creating",
      title: PROJECT_NAME,
    },
    {
      events: [
        event(time, -50 * SECOND_MS, "evt-db", "Database cluster is ready.", {
          severity: "success",
          source: "resource-observer",
        }),
      ],
      id: `DB:${namespace}:pg-main`,
      latestStatusText: "Ready",
      required: true,
      resultRef: { kind: "DB", name: "pg-main", namespace },
      status: "running",
      title: "pg-main",
    },
    {
      events: ready
        ? [
            event(
              time,
              -30 * SECOND_MS,
              "evt-pa",
              "Public Address is accessible.",
              {
                severity: "success",
                source: "health-check",
              }
            ),
          ]
        : [],
      id: `PublicAccess:${namespace}:${PROJECT_NAME}:pa_web`,
      ...(ready ? { latestStatusText: "accessible" } : {}),
      required: false,
      resultRef: {
        apName: PROJECT_NAME,
        id: "pa_web",
        kind: "PublicAccess",
        namespace,
      },
      status: ready ? "running" : "pending",
      title: "Public access",
    },
  ];
}

interface ScenarioShape {
  cancelRequestedAt: string | null;
  completedAt: string | null;
  error: string | null;
  failureDetails: DeployTaskDTO["failureDetails"];
  phase: DeployTaskDTO["phase"];
  resultUrl: string | null;
  status: DeployTaskStatus;
  steps: DeploymentTimelineStep[];
}

function scenarioShape(
  scenario: DeployTaskDevScenario,
  time: FixtureClock,
  namespace: string
): ScenarioShape {
  const prepare = step(
    "prepare-workspace",
    "Prepare workspace",
    0,
    "completed",
    [event(time, -4 * MINUTE_MS, "evt-1", "Runtime workspace is ready.")]
  );
  const analyze = step("analyze-source", "Analyze repository", 1, "completed", [
    event(time, -3.5 * MINUTE_MS, "evt-2", `Cloned ${REPO}@main.`),
    event(
      time,
      -3 * MINUTE_MS,
      "evt-3",
      "Detected a Next.js app with a PostgreSQL dependency."
    ),
  ]);
  const generate = step(
    "generate-deployment",
    "Generate deployment",
    2,
    "completed",
    [
      event(
        time,
        -2 * MINUTE_MS,
        "evt-4",
        "Planned 1 AP, 1 DB and 1 Public Address."
      ),
    ]
  );
  switch (scenario) {
    case "running":
      return {
        cancelRequestedAt: null,
        completedAt: null,
        error: null,
        failureDetails: null,
        phase: "apply",
        resultUrl: null,
        status: "applying",
        steps: [
          prepare,
          analyze,
          generate,
          step(
            "create-resources",
            "Create resources",
            3,
            "running",
            [
              event(
                time,
                -MINUTE_MS,
                "evt-5",
                "Applying deployment artifacts."
              ),
            ],
            resultCards(time, namespace, "creating")
          ),
        ],
      };
    case "blocked":
      return {
        cancelRequestedAt: null,
        completedAt: null,
        error: null,
        failureDetails: null,
        phase: "configure",
        resultUrl: null,
        status: "blocked",
        steps: [
          prepare,
          analyze,
          step("generate-deployment", "Generate deployment", 2, "blocked", [
            event(
              time,
              -2 * MINUTE_MS,
              "evt-4",
              "Two values are needed before the deployment can continue.",
              { severity: "warning" }
            ),
          ]),
          step("create-resources", "Create resources", 3, "pending", []),
        ],
      };
    case "failed":
      return {
        cancelRequestedAt: null,
        completedAt: time.at(-MINUTE_MS),
        error: "Image build failed: `npm run build` exited with status 1.",
        failureDetails: {
          failureMessage:
            "Image build failed: `npm run build` exited with status 1.",
          reason: "image-build-failed",
          stage: "apply",
        },
        phase: "apply",
        resultUrl: null,
        status: "failed",
        steps: [
          prepare,
          analyze,
          generate,
          step("create-resources", "Create resources", 3, "failed", [
            event(
              time,
              -90 * SECOND_MS,
              "evt-5",
              "Building the container image."
            ),
            event(
              time,
              -MINUTE_MS,
              "evt-6",
              "Image build failed: `npm run build` exited with status 1.",
              {
                dedupeKey: DEPLOYMENT_TASK_TERMINAL_FAILURE_EVENT_KEY,
                reason: "image-build-failed",
                severity: "error",
              }
            ),
          ]),
        ],
      };
    case "succeeded":
      return {
        cancelRequestedAt: null,
        completedAt: time.at(-30 * SECOND_MS),
        error: null,
        failureDetails: null,
        phase: "completed",
        resultUrl: "https://web-app.mock.sealos.run",
        status: "completed",
        steps: [
          prepare,
          analyze,
          generate,
          step(
            "create-resources",
            "Create resources",
            3,
            "completed",
            [
              event(
                time,
                -MINUTE_MS,
                "evt-5",
                "Applying deployment artifacts."
              ),
              event(
                time,
                -30 * SECOND_MS,
                "evt-6",
                "All resources are ready.",
                {
                  severity: "success",
                }
              ),
            ],
            resultCards(time, namespace, "ready")
          ),
        ],
      };
    case "cancelled":
      return {
        cancelRequestedAt: time.at(-70 * SECOND_MS),
        completedAt: time.at(-MINUTE_MS),
        error: null,
        failureDetails: { reason: "cancelled" },
        phase: "generate-artifacts",
        resultUrl: null,
        status: "cancelled",
        steps: [
          prepare,
          analyze,
          step("generate-deployment", "Generate deployment", 2, "skipped", [
            event(time, -MINUTE_MS, "evt-4", "Cancelled by the user.", {
              severity: "warning",
            }),
          ]),
          step("create-resources", "Create resources", 3, "skipped", []),
        ],
      };
    default:
      return scenario satisfies never;
  }
}

const RESOURCE_SLOTS = (namespace: string) => ({
  resources: [
    {
      apiVersion: "apps/v1",
      kind: "Deployment",
      name: PROJECT_NAME,
      namespace,
    },
    {
      apiVersion: "apps.kubeblocks.io/v1alpha1",
      kind: "Cluster",
      name: "pg-main",
      namespace,
    },
  ],
  slots: [
    {
      anchor: true,
      expectedRef: { kind: "AP" as const, name: PROJECT_NAME, namespace },
      id: "slot-ap",
    },
    {
      expectedRef: { kind: "DB" as const, name: "pg-main", namespace },
      id: "slot-db",
    },
  ],
});

export function deployTaskDevMockTask(
  scenario: DeployTaskDevScenario,
  input: { namespace: string; nowMs: number; projectId: string | null }
): DeploymentTaskTimelineSnapshotDTO {
  const time = clock(input.nowMs);
  const shape = scenarioShape(scenario, time, input.namespace);
  const taskId = deployTaskDevMockTaskId(scenario);
  const facts = RESOURCE_SLOTS(input.namespace);
  const timeline: DeploymentTaskTimelineSnapshot = {
    revision: shape.steps.length,
    status: shape.status,
    steps: shape.steps,
    taskId,
    updatedAt: time.at(-30 * SECOND_MS),
  };
  const task: DeployTaskDTO = {
    artifactSummary: {
      resources: facts.resources,
    },
    blockingInputs:
      scenario === "blocked"
        ? [
            {
              id: "DATABASE_PASSWORD",
              key: "DATABASE_PASSWORD",
              label: "Database password",
              required: true,
              sensitive: true,
              type: "secret",
            },
            {
              defaultValue: "3",
              description: "Replicas for the web workload",
              id: "REPLICAS",
              key: "REPLICAS",
              label: "Replicas",
              options: ["1", "2", "3"],
              required: true,
              type: "text",
              valueType: "choice",
            },
          ]
        : [],
    cancelRequestedAt: shape.cancelRequestedAt,
    canvasProjection: {
      edges: [{ sourceSlotId: "slot-ap", targetSlotId: "slot-db" }],
      slots: facts.slots,
      ...(scenario === "succeeded"
        ? {
            resultMappings: facts.slots.map((slot) => ({
              actualRef: slot.expectedRef,
              slotId: slot.id,
            })),
          }
        : {}),
    },
    completedAt: shape.completedAt,
    createdAt: time.at(-5 * MINUTE_MS),
    createdFrom: "ui",
    error: shape.error,
    failureDetails: shape.failureDetails,
    gatewaySessionId: null,
    gatewayStateSnapshot: null,
    gatewayTurnId: null,
    gatewayUrl: null,
    id: taskId,
    namespace: input.namespace,
    phase: shape.phase,
    previewUrl: null,
    projectId: input.projectId,
    projectName: PROJECT_NAME,
    resultUrl: shape.resultUrl,
    retriedFromTaskId: null,
    runner: { kind: "ai", runtimeProvider: "devbox" },
    runtimeName: "devbox-web-app",
    runtimeProvider: "devbox",
    runtimeState: shape.completedAt == null ? "Running" : "Stopped",
    source: {
      branch: "main",
      kind: "github",
      repo: {
        fullName: REPO,
        name: PROJECT_NAME,
        url: `https://github.com/${REPO}`,
      },
    },
    startedAt: time.at(-4.5 * MINUTE_MS),
    status: shape.status,
    target:
      input.projectId == null
        ? { displayName: PROJECT_NAME, kind: "newProject" }
        : {
            kind: "existingProject",
            projectId: input.projectId,
            projectName: PROJECT_NAME,
          },
    timelineSnapshot: timeline,
    updatedAt: time.at(-30 * SECOND_MS),
  };
  const events: DeployTaskEventDTO[] = shape.steps.flatMap((entry) =>
    entry.events.map((item, index) => ({
      createdAt: item.createdAt,
      kind: `deployment_task.${entry.status}`,
      message: item.message,
      payload: item.reason == null ? {} : { reason: item.reason },
      phase: shape.phase,
      seq: entry.order * 10 + index,
      taskId,
    }))
  );
  return { events, task, timeline };
}

export function deployTaskDevMockProjection(
  scenario: DeployTaskDevScenario,
  input: { namespace: string; nowMs: number; projectId: string }
): DeploymentTaskProjection {
  const { task } = deployTaskDevMockTask(scenario, input);
  return {
    artifactSummary: task.artifactSummary,
    cancelRequestedAt: task.cancelRequestedAt ?? null,
    canvasProjection: task.canvasProjection,
    completedAt: task.completedAt,
    display: {
      resultSummary: PROJECT_NAME,
      sourceKind: "github",
      sourceSummary: `${REPO}@main`,
    },
    id: task.id,
    namespace: task.namespace,
    phase: task.phase,
    projectId: input.projectId,
    ...(task.canvasProjection.resultMappings == null
      ? {}
      : { resultMappings: task.canvasProjection.resultMappings }),
    retriedFromTaskId: null,
    status: task.status,
    updatedAt: task.updatedAt,
  };
}

export type DeployTaskDevMockRoute =
  | "list"
  | "projections-stream"
  | "timeline"
  | "timeline-stream";

const HEARTBEAT_MS = 10_000;

function encodeSse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** One snapshot frame, then heartbeats until the client goes away. */
function staticSseResponse(
  request: Request,
  event: string,
  data: unknown
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let timer: ReturnType<typeof setInterval> | undefined;
      const close = () => {
        if (timer != null) {
          clearInterval(timer);
          timer = undefined;
        }
        try {
          controller.close();
        } catch {
          // Already closed by the client.
        }
      };
      if (request.signal.aborted) {
        close();
        return;
      }
      request.signal.addEventListener("abort", close, { once: true });
      controller.enqueue(encoder.encode(encodeSse(event, data)));
      timer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          close();
        }
      }, HEARTBEAT_MS);
    },
  });
  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}

function namespaceOf(request: Request): string {
  return (
    new URL(request.url).searchParams.get("namespace")?.trim() || "ns-mock"
  );
}

/**
 * Answers a deploy-task route from fixtures while the mock is on; null hands
 * the request to the real handler. The timeline routes answer only for the
 * fixture task so real tasks stay reachable; the list and projection
 * stream answer with the fixture alone.
 */
export function deployTaskDevMockResponse(
  route: DeployTaskDevMockRoute,
  request: Request,
  taskId: string | null
): Response | null {
  const resolution = resolveDevMock(
    deployTaskDevMockCookie,
    request,
    "deploy task"
  );
  if (resolution.kind === "off") {
    return null;
  }
  if (resolution.kind === "invalid") {
    return resolution.response;
  }
  const { scenario } = resolution;
  const url = new URL(request.url);
  const namespace = namespaceOf(request);
  const nowMs = Date.now();
  switch (route) {
    case "timeline":
    case "timeline-stream": {
      if (taskId !== deployTaskDevMockTaskId(scenario)) {
        return null;
      }
      const snapshot = deployTaskDevMockTask(scenario, {
        namespace,
        nowMs,
        projectId: null,
      });
      if (route === "timeline") {
        return Response.json(snapshot);
      }
      const frame: DeploymentTaskTimelineStreamEvent = {
        snapshot,
        type: "snapshot",
      };
      return staticSseResponse(request, "snapshot", frame);
    }
    case "list": {
      const projectId = url.searchParams.get("projectId")?.trim() || null;
      if (url.searchParams.get("view") === "tasks") {
        const { task } = deployTaskDevMockTask(scenario, {
          namespace,
          nowMs,
          projectId,
        });
        return Response.json({ nextCursor: null, tasks: [task] });
      }
      if (projectId == null) {
        return Response.json({ projections: [] });
      }
      return Response.json({
        projections: [
          deployTaskDevMockProjection(scenario, {
            namespace,
            nowMs,
            projectId,
          }),
        ],
      });
    }
    case "projections-stream": {
      const projectId = url.searchParams.get("projectId")?.trim();
      if (!projectId) {
        return Response.json(
          { error: "Project ID is required." },
          { status: 400 }
        );
      }
      return staticSseResponse(request, "snapshot", {
        projections: [
          deployTaskDevMockProjection(scenario, {
            namespace,
            nowMs,
            projectId,
          }),
        ],
        type: "snapshot",
      });
    }
    default:
      return route satisfies never;
  }
}
