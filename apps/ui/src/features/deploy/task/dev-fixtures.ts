import { resolveDevMock } from "@/features/dev-mock/server/resolve";
import { MINUTE_MS } from "@/lib/time";
import {
  type DeployTaskDevScenario,
  deployTaskDevMockCookie,
  deployTaskDevMockTaskId,
} from "./dev-mock-cookie";
import {
  deploymentFailureMessage,
  isDeployTaskFailureReason,
} from "./failure-summary";
import {
  type DeploymentTaskProjection,
  deploymentTaskSourceSummary,
} from "./projection";
import type {
  DeploymentTaskRunner,
  DeploymentTaskSource,
  DeployTaskStatus,
} from "./schema";
import {
  attachDeploymentTaskSuccess,
  DEPLOYMENT_TASK_TERMINAL_FAILURE_EVENT_KEY,
  type DeploymentResultResourceCard,
  type DeploymentTaskSuccessAttachment,
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
 * Deployment Task Timeline dev fixtures: one task per scenario deploying
 * `acme/web-app` with the AI runner, plus a template-installed game server for
 * the verified-success shape (issue #160). The timeline route and its
 * SSE stream answer for the fixture task id; the task list and projection
 * stream answer with the fixture alone so the Deployment Task Dock shows
 * its chip. Timestamps are relative to the request so completion windows
 * (canvas placeholder, dock notice) behave as they would live. Static: the
 * stream sends the snapshot once and then only heartbeats.
 */

const SECOND_MS = 1000;
const PUBLIC_HOST_SUFFIX = "mock.sealos.run";
const WEB_APP_DATABASE = "pg-main";

/**
 * What a scenario deploys. Every scenario shares one task skeleton — one
 * workload, one public address — so the product is threaded through the
 * builders instead of forked per scenario. The EaglerCraft product exists to
 * give the success card real first-use content (#160), not to model a second
 * deployment path.
 */
interface FixtureProduct {
  /** Set when the deployment also stands up a database. */
  database?: string;
  /** The runner that owns the task; its kind decides the step set. */
  runner: DeploymentTaskRunner;
  /** Source identity — also the success card's product name, as in the runner. */
  source: DeploymentTaskSource;
  /** Kubernetes name of the workload, its project and its public host. */
  workload: string;
}

const WEB_APP: FixtureProduct = {
  database: WEB_APP_DATABASE,
  runner: { kind: "ai", runtimeProvider: "devbox" },
  source: {
    branch: "main",
    kind: "github",
    repo: {
      fullName: "acme/web-app",
      name: "web-app",
      url: "https://github.com/acme/web-app",
    },
  },
  workload: "web-app",
};

/**
 * A game server installed from the app store: no repository, no database, and
 * a first-use path that is not simply "click the link" — the player connects
 * to this address from a client somewhere else. That is what the success
 * contract's guidance exists for.
 */
const EAGLERCRAFT: FixtureProduct = {
  runner: { kind: "template" },
  source: { kind: "template", templateName: "EaglerCraft Server" },
  workload: "eaglercraft-server",
};

function productForScenario(scenario: DeployTaskDevScenario): FixtureProduct {
  return scenario === "succeeded-eaglercraft" ? EAGLERCRAFT : WEB_APP;
}

/** The one address the fixture's contract declares. */
function publicUrl(product: FixtureProduct): string {
  return `https://${product.workload}.${PUBLIC_HOST_SUFFIX}`;
}

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
  product: FixtureProduct,
  phase: "creating" | "ready"
): DeploymentResultResourceCard[] {
  const ready = phase === "ready";
  const workload = product.workload;
  // Typed on its own so the literal's narrow fields survive being spread into
  // the list conditionally — a bare inline spread would widen them to string.
  const database: DeploymentResultResourceCard | null =
    product.database == null
      ? null
      : {
          events: [
            event(
              time,
              -50 * SECOND_MS,
              "evt-db",
              "Database cluster is ready.",
              { severity: "success", source: "resource-observer" }
            ),
          ],
          id: `DB:${namespace}:${product.database}`,
          latestStatusText: "Ready",
          required: true,
          resultRef: { kind: "DB", name: product.database, namespace },
          status: "running",
          title: product.database,
        };
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
      id: `AP:${namespace}:${workload}`,
      latestStatusText: ready ? "1/1 replicas ready" : "0/1 replicas ready",
      required: true,
      resultRef: { kind: "AP", name: workload, namespace },
      status: ready ? "running" : "creating",
      title: workload,
    },
    ...(database == null ? [] : [database]),
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
      id: `PublicAccess:${namespace}:${workload}:pa_web`,
      ...(ready ? { latestStatusText: "accessible" } : {}),
      required: false,
      resultRef: {
        apName: workload,
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
  /** Appended after the steps, so its revision is always the later one. */
  success?: DeploymentTaskSuccessAttachment;
}

function scenarioShape(
  scenario: DeployTaskDevScenario,
  time: FixtureClock,
  namespace: string,
  product: FixtureProduct
): ScenarioShape {
  const repoSummary =
    product.source.kind === "github"
      ? `${product.source.repo.fullName}@${product.source.branch ?? "main"}`
      : deploymentTaskSourceSummary(product.source);
  const prepare = step(
    "prepare-workspace",
    "Prepare workspace",
    0,
    "completed",
    [event(time, -4 * MINUTE_MS, "evt-1", "Runtime workspace is ready.")]
  );
  const analyze = step("analyze-source", "Analyze repository", 1, "completed", [
    event(time, -3.5 * MINUTE_MS, "evt-2", `Cloned ${repoSummary}.`),
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
            resultCards(time, namespace, product, "creating")
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
    // The interruption scenes (catalog E1/E2): the run died on the
    // platform's money or quota wall and the reverse-check named it.
    case "failed-balance": {
      const message = deploymentFailureMessage("balance-exhausted");
      return {
        cancelRequestedAt: null,
        completedAt: time.at(-MINUTE_MS),
        error: message,
        failureDetails: {
          billingEvidence: {
            availableBalanceMicroUnits: -6_320_000,
            checkedAt: time.at(-MINUTE_MS),
            kind: "account-debt",
          },
          failureMessage: message,
          reason: "balance-exhausted",
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
              "Applying deployment artifacts."
            ),
            event(time, -MINUTE_MS, "evt-6", message, {
              dedupeKey: DEPLOYMENT_TASK_TERMINAL_FAILURE_EVENT_KEY,
              reason: "balance-exhausted",
              severity: "error",
            }),
          ]),
        ],
      };
    }
    case "failed-quota": {
      const message = deploymentFailureMessage("quota-exceeded");
      const rawError =
        'persistentvolumeclaims "web-app-data" is forbidden: exceeded quota: quota-ns-test, requested: requests.storage=2Gi, used: requests.storage=20Gi, limited: requests.storage=20Gi';
      return {
        cancelRequestedAt: null,
        completedAt: time.at(-MINUTE_MS),
        error: rawError,
        failureDetails: {
          billingEvidence: {
            kind: "quota-full",
            label: "Storage",
            percentUsed: 100,
            type: "storage",
          },
          failureMessage: message,
          reason: "quota-exceeded",
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
              "Applying deployment artifacts."
            ),
            event(time, -MINUTE_MS, "evt-6", message, {
              dedupeKey: DEPLOYMENT_TASK_TERMINAL_FAILURE_EVENT_KEY,
              reason: "quota-exceeded",
              severity: "error",
            }),
          ]),
        ],
      };
    }
    case "succeeded":
      return {
        cancelRequestedAt: null,
        completedAt: time.at(-30 * SECOND_MS),
        error: null,
        failureDetails: null,
        phase: "completed",
        resultUrl: publicUrl(product),
        // Exactly what the AI runner declares once its readiness gate passes:
        // the probed public address and the checks behind it. No headline and
        // no guidance, so the card falls back (#160).
        success: {
          entries: [{ label: "Public address", url: publicUrl(product) }],
          productName: deploymentTaskSourceSummary(product.source),
          verification: { passed: 3, total: 3 },
        },
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
            resultCards(time, namespace, product, "ready")
          ),
        ],
      };
    case "succeeded-eaglercraft":
      return {
        cancelRequestedAt: null,
        completedAt: time.at(-30 * SECOND_MS),
        error: null,
        failureDetails: null,
        phase: "completed",
        resultUrl: publicUrl(product),
        // The same record with the fields a product contract is allowed to
        // declare: how to reach the server, and what to do with it. The
        // address appears once, as declared — no protocol is derived here.
        success: {
          entries: [{ label: "Server address", url: publicUrl(product) }],
          guidance: [
            {
              detail: "Keep it open in another tab.",
              label: "Open the EaglerCraft client in your browser.",
            },
            { label: "Go to Multiplayer and add a server." },
            { detail: publicUrl(product), label: "Paste the server address." },
            { label: "Join the server and start playing." },
          ],
          headline: "Your server is online",
          openActionLabel: "Open server",
          productName: deploymentTaskSourceSummary(product.source),
          verification: { passed: 2, total: 2 },
        },
        status: "completed",
        steps: [
          step("prepare-template", "Prepare template", 0, "completed", [
            event(
              time,
              -3 * MINUTE_MS,
              "evt-e1",
              "Resolved the template and its defaults."
            ),
            event(
              time,
              -2 * MINUTE_MS,
              "evt-e2",
              "Applied the instance configuration."
            ),
          ]),
          step(
            "create-resources",
            "Create resources",
            1,
            "completed",
            [
              event(
                time,
                -90 * SECOND_MS,
                "evt-e3",
                "Applying deployment artifacts."
              ),
              event(
                time,
                -45 * SECOND_MS,
                "evt-e4",
                "Workload has 1/1 ready replicas.",
                {
                  severity: "success",
                  source: "resource-observer",
                }
              ),
              event(
                time,
                -30 * SECOND_MS,
                "evt-e5",
                "Public Address is accessible.",
                {
                  severity: "success",
                  source: "health-check",
                }
              ),
            ],
            resultCards(time, namespace, product, "ready")
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

/** The devbox runtime belongs to the AI runner alone; other runners have none. */
function runtimeStateFor(
  runner: DeploymentTaskRunner,
  completedAt: string | null
): string | null {
  if (runner.kind !== "ai") {
    return null;
  }
  return completedAt == null ? "Running" : "Stopped";
}

const RESOURCE_SLOTS = (namespace: string, product: FixtureProduct) => ({
  resources: [
    {
      apiVersion: "apps/v1",
      kind: "Deployment",
      name: product.workload,
      namespace,
    },
    ...(product.database == null
      ? []
      : [
          {
            apiVersion: "apps.kubeblocks.io/v1alpha1",
            kind: "Cluster",
            name: product.database,
            namespace,
          },
        ]),
  ],
  slots: [
    {
      anchor: true,
      expectedRef: { kind: "AP" as const, name: product.workload, namespace },
      id: "slot-ap",
    },
    ...(product.database == null
      ? []
      : [
          {
            expectedRef: {
              kind: "DB" as const,
              name: product.database,
              namespace,
            },
            id: "slot-db",
          },
        ]),
  ],
});

export function deployTaskDevMockTask(
  scenario: DeployTaskDevScenario,
  input: { namespace: string; nowMs: number; projectId: string | null }
): DeploymentTaskTimelineSnapshotDTO {
  const time = clock(input.nowMs);
  const product = productForScenario(scenario);
  const shape = scenarioShape(scenario, time, input.namespace, product);
  const taskId = deployTaskDevMockTaskId(scenario);
  const facts = RESOURCE_SLOTS(input.namespace, product);
  const timeline: DeploymentTaskTimelineSnapshot = {
    revision: shape.steps.length,
    status: shape.status,
    steps: shape.steps,
    taskId,
    updatedAt: time.at(-30 * SECOND_MS),
  };
  // Success is appended the way the runner appends it — after the steps, so
  // its revision is the later one and the celebration key stays stable.
  const snapshotTimeline =
    shape.success == null
      ? timeline
      : attachDeploymentTaskSuccess(timeline, {
          success: shape.success,
          updatedAt: time.at(-30 * SECOND_MS),
        });
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
      edges:
        product.database == null
          ? []
          : [{ sourceSlotId: "slot-ap", targetSlotId: "slot-db" }],
      slots: facts.slots,
      ...(shape.status === "completed"
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
    projectName: product.workload,
    resultUrl: shape.resultUrl,
    retriedFromTaskId: null,
    runner: product.runner,
    runtimeName:
      product.runner.kind === "ai" ? `devbox-${product.workload}` : null,
    runtimeProvider: product.runner.kind === "ai" ? "devbox" : null,
    runtimeState: runtimeStateFor(product.runner, shape.completedAt),
    source: product.source,
    startedAt: time.at(-4.5 * MINUTE_MS),
    status: shape.status,
    target:
      input.projectId == null
        ? { displayName: product.workload, kind: "newProject" }
        : {
            kind: "existingProject",
            projectId: input.projectId,
            projectName: product.workload,
          },
    timelineSnapshot: snapshotTimeline,
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
  return { events, task, timeline: snapshotTimeline };
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
      resultSummary: task.projectName ?? task.id,
      sourceKind: task.source.kind,
      sourceSummary: deploymentTaskSourceSummary(task.source),
    },
    failureReason:
      task.status === "failed" &&
      isDeployTaskFailureReason(task.failureDetails?.reason)
        ? task.failureDetails.reason
        : null,
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
