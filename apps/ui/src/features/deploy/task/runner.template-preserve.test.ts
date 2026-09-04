import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { createRequire } from "node:module";
import type { DeployTaskHandle } from "./engine/handle";
import type { DeployTaskRow } from "./schema";

// Regression harness for AIM-33: drive the real template control flow in
// runDeployTask with the external seams mocked, and assert cleanup behavior
// by counting k8s DELETE requests at the global-fetch seam (ADR 0037/0038).
// Everything loads synchronously via require — top-level await in a test
// file interleaves bun's file loading with test execution and crashes every
// later node:test file in the same run. The fetch interception deliberately
// stubs globalThis.fetch instead of mock.module("@workspace/api/fetch"):
// modules evaluated while a module mock is registered keep that binding
// forever, which would poison every cached consumer of the fetch module in
// later test files.

const requireModule = createRequire(import.meta.url);

const fetchCalls: { method?: string; url: string }[] = [];
const originalFetch = globalThis.fetch;
const originalApiUrl = process.env.API_URL;

function installFetchRecorder() {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls.push({ method: init?.method, url: String(input) });
    if (String(input).includes("/api/k8s/v1alpha1/get")) {
      const url = new URL(String(input));
      if (url.searchParams.get("kind") === "ingresses") {
        const name = url.searchParams.get("name");
        return Promise.resolve(
          Response.json({
            apiVersion: "networking.k8s.io/v1",
            kind: "Ingress",
            metadata: { name, namespace: "ns-demo" },
            spec: {
              rules: [{ host: "eaglercraft-demo.example.sealos.run" }],
              tls: [{ hosts: ["eaglercraft-demo.example.sealos.run"] }],
            },
          })
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            apiVersion: "app.sealos.io/v1",
            kind: "Instance",
            metadata: { name: "demo", uid: "instance-uid" },
          }),
          {
            headers: { "Content-Type": "application/json" },
            status: 200,
          }
        )
      );
    }
    return Promise.resolve(
      new Response("{}", {
        headers: { "Content-Type": "application/json" },
        status: 200,
      })
    );
  }) as typeof fetch;
}
const failCalls: Record<string, unknown>[] = [];
const completeCalls: unknown[] = [];
const eventKinds: string[] = [];
const requestInputsCalls: unknown[] = [];
const stateWrites: Record<string, unknown>[] = [];
const timelineEvents: Record<string, unknown>[] = [];

let currentRow: DeployTaskRow;
let deployTemplateInstanceImpl: () => Promise<{
  instanceName: string;
  resources: { name: string; resourceType: string }[];
}>;

const activeController = new AbortController();

// "server-only" stays shimmed for the whole process: its real module throws
// outside a react-server condition and exports no runtime API, so the shim
// can never change another file's behavior.
mock.module("server-only", () => ({}));

// Real modules are captured before mocking so afterAll can restore them —
// bun's mock.module patches the process-wide module cache, and without a
// restore these mocks would poison every later test file in the same run.
const realTemplateProvider = requireModule(
  "@/features/deploy/template-provider-core"
);
const realProjects = requireModule("@/lib/project-persistence/projects");
const realService = requireModule("./service");
const realRunnerWrites = requireModule("./runner-writes");
const realResultReadiness = requireModule("./result-readiness");

afterAll(() => {
  globalThis.fetch = originalFetch;
  mock.module("@/features/deploy/template-provider-core", () => ({
    ...realTemplateProvider,
  }));
  mock.module("@/lib/project-persistence/projects", () => ({
    ...realProjects,
  }));
  mock.module("./service", () => ({ ...realService }));
  mock.module("./runner-writes", () => ({ ...realRunnerWrites }));
  mock.module("./result-readiness", () => ({ ...realResultReadiness }));
  delete process.env.DIRECT_AP_READINESS_TIMEOUT_MS;
  if (originalApiUrl === undefined) {
    delete process.env.API_URL;
  } else {
    process.env.API_URL = originalApiUrl;
  }
});

mock.module("@/features/deploy/template-provider-core", () => ({
  ...realTemplateProvider,
  deployTemplateInstance: (input: { instanceName: string }) =>
    deployTemplateInstanceImpl().then((deployed) => ({
      ...deployed,
      instanceName: input.instanceName,
    })),
  getTemplateSource: () =>
    Promise.reject(new Error("template declarations unavailable")),
}));

mock.module("@/lib/project-persistence/projects", () => ({
  createProject: () => Promise.reject(new Error("not used in this harness")),
  getProject: () => Promise.reject(new Error("not used in this harness")),
}));

mock.module("./service", () => ({
  ...realService,
  getDeployTaskById: () => Promise.resolve(currentRow),
  getDeployTaskTimelineSnapshot: () => Promise.resolve(null),
}));

mock.module("./runner-writes", () => ({
  deployTaskBeginApplying: () => Promise.resolve(),
  deployTaskCheckpoint: () => Promise.resolve(),
  deployTaskComplete: (...input: unknown[]) => {
    completeCalls.push(input);
    return Promise.resolve();
  },
  deployTaskRequestInputs: (_taskId: string, input: unknown) => {
    requestInputsCalls.push(input);
    return Promise.resolve();
  },
  deployTaskRunSignal: () => activeController.signal,
  recordDeployTaskEvent: (
    _taskId: string,
    event: { kind: string; [key: string]: unknown }
  ): Promise<void> => {
    eventKinds.push(event.kind);
    return Promise.resolve();
  },
  throwIfDeployTaskAborted: () => Promise.resolve(),
  // Persisted patches feed back into the row later runs read, so a
  // blocked-then-resumed sequence sees exactly what the run persisted —
  // the seam the identity-freshness regression travels through.
  updateDeployTaskState: (
    _taskId: string,
    patch: Record<string, unknown>
  ): Promise<void> => {
    stateWrites.push(patch);
    currentRow = {
      ...currentRow,
      ...patch,
      artifactSummary: {
        ...currentRow.artifactSummary,
        ...(patch.artifactSummary as Record<string, unknown> | undefined),
      },
    } as DeployTaskRow;
    return Promise.resolve();
  },
  updateDeployTaskTimeline: (
    _taskId: string,
    input: { event?: Record<string, unknown> }
  ) => {
    if (input.event !== undefined) {
      timelineEvents.push(input.event);
    }
    return Promise.resolve();
  },
}));

mock.module("./result-readiness", () => ({
  ...realResultReadiness,
  isResultReadinessTerminalError: () => false,
  observeDeploymentResultCardReadiness: () =>
    Promise.reject(new Error("provider-secret-readiness-token")),
}));

const { runDeployTask } = requireModule(
  "./runner"
) as typeof import("./runner");

function templateTaskRow(input: {
  recordedInstanceName?: string;
  sensitiveKeys?: string[];
}): DeployTaskRow {
  return {
    artifactSummary:
      input.recordedInstanceName == null
        ? {}
        : {
            resultIdentities: {
              templateInstanceName: input.recordedInstanceName,
            },
          },
    blockingInputs: [],
    githubConnectionId: null,
    id: "task-1",
    namespace: "ns-demo",
    phase: "plan",
    projectId: "proj-1",
    projectName: "proj-1",
    runner: { kind: "template" },
    source: {
      args: {},
      kind: "template",
      templateName: "dify",
      ...(input.sensitiveKeys == null
        ? {}
        : { sensitiveKeys: input.sensitiveKeys }),
    },
    status: "running",
    target: { kind: "existingProject", projectId: "proj-1" },
  } as unknown as DeployTaskRow;
}

function runnerHandle(): DeployTaskHandle {
  return {
    fail: (input: Record<string, unknown>) => {
      failCalls.push(input);
      return Promise.resolve();
    },
    outcome: () => null,
    setState: () => Promise.resolve(),
  } as unknown as DeployTaskHandle;
}

function deleteCalls() {
  return fetchCalls.filter((call) => call.method === "DELETE");
}

function deletedKind(url: string): string | null {
  return new URL(url, "http://fallback.test").searchParams.get("kind");
}

function attachedFailureDetails(): Record<string, unknown> {
  const details = failCalls[0]?.failureDetails;
  return (details ?? {}) as Record<string, unknown>;
}

async function runTemplateTask(input?: {
  submittedInputValues?: Record<string, unknown>;
}) {
  await runDeployTask(runnerHandle(), {
    encodedKubeconfig: "kubeconfig-for-tests",
    submittedInputValues: input?.submittedInputValues,
    taskId: "task-1",
  });
}

describe("template deployment failure cleanup (AIM-33)", () => {
  beforeEach(() => {
    installFetchRecorder();
    fetchCalls.length = 0;
    failCalls.length = 0;
    completeCalls.length = 0;
    eventKinds.length = 0;
    requestInputsCalls.length = 0;
    stateWrites.length = 0;
    timelineEvents.length = 0;
    process.env.API_URL = "https://api.example.com";
    process.env.DIRECT_AP_READINESS_TIMEOUT_MS = "1";
    currentRow = templateTaskRow({});
    deployTemplateInstanceImpl = () =>
      Promise.resolve({
        instanceName: "unused",
        resources: [{ name: "dify-api", resourceType: "StatefulSet" }],
      });
  });

  it("preserves applied resources when readiness times out", async () => {
    await runTemplateTask();

    expect(deleteCalls()).toHaveLength(0);
    expect(eventKinds).not.toContain(
      "deployment_task.template_cleanup_started"
    );
    expect(completeCalls).toHaveLength(0);
    expect(failCalls).toHaveLength(1);
    expect(attachedFailureDetails().reason).toBe("readiness-timeout");
    expect(attachedFailureDetails().stage).toBe("readiness");
  });

  it("reads provider Ingress resources into the task Timeline before readiness", async () => {
    deployTemplateInstanceImpl = () =>
      Promise.resolve({
        instanceName: "unused",
        resources: [
          { name: "eaglercraft-demo", resourceType: "StatefulSet" },
          { name: "eaglercraft-demo", resourceType: "ingress" },
          { name: "eaglercraft-demo-admin", resourceType: "Ingress" },
        ],
      });

    await runTemplateTask();

    const publicAccessRefs = [
      ...new Map(
        timelineEvents.flatMap((event) => {
          const payload = event.payload as
            | {
                resultRef?: {
                  id?: string;
                  kind?: string;
                  label?: string;
                  name?: string;
                  namespace?: string;
                  observer?: { kind?: string; name?: string };
                  protocol?: string;
                  url?: string;
                };
              }
            | undefined;
          return payload?.resultRef?.kind === "AccessEndpoint"
            ? [[payload.resultRef.url, payload.resultRef] as const]
            : [];
        })
      ).values(),
    ];
    expect(publicAccessRefs).toEqual([
      {
        id: "ingress:eaglercraft-demo:eaglercraft-demo.example.sealos.run",
        kind: "AccessEndpoint",
        label: "Public domain",
        namespace: "ns-demo",
        observer: { kind: "ingress", name: "eaglercraft-demo" },
        protocol: "https",
        url: "https://eaglercraft-demo.example.sealos.run",
      },
    ]);
  });

  it("cleans up a freshly allocated identity when the apply call itself fails", async () => {
    deployTemplateInstanceImpl = () =>
      Promise.reject(new Error("template provider returned 500"));

    await runTemplateTask();

    const kinds = deleteCalls().map((call) => deletedKind(call.url));
    expect(kinds).toHaveLength(9);
    expect(kinds).toContain("persistentvolumeclaims");
    expect(eventKinds).toContain("deployment_task.template_cleanup_started");
    expect(failCalls).toHaveLength(1);
    expect(attachedFailureDetails().stage).toBe("apply");
  });

  it("never deletes preserved resources when a reused identity's apply fails", async () => {
    currentRow = templateTaskRow({ recordedInstanceName: "dify-template-1" });
    deployTemplateInstanceImpl = () =>
      Promise.reject(new Error("template provider returned 500"));

    await runTemplateTask();

    expect(deleteCalls()).toHaveLength(0);
    expect(eventKinds).not.toContain(
      "deployment_task.template_cleanup_started"
    );
    expect(failCalls).toHaveLength(1);
    expect(attachedFailureDetails().stage).toBe("apply");
  });

  it("a run blocked on inputs persists no identity, so the resumed run's apply failure still cleans up", async () => {
    // Declarations are unavailable in this harness, so a stripped sensitive
    // key with no in-memory value parks the run on the blocking-input gate.
    currentRow = templateTaskRow({ sensitiveKeys: ["API_KEY"] });
    deployTemplateInstanceImpl = () =>
      Promise.reject(new Error("template provider returned 500"));

    await runTemplateTask();

    // Run 1 blocked before applying anything: no failure, no deletes, and —
    // the regression under test — no persisted instance identity.
    expect(requestInputsCalls).toHaveLength(1);
    expect(failCalls).toHaveLength(0);
    expect(deleteCalls()).toHaveLength(0);
    const persistedIdentity = stateWrites.some((patch) => {
      const summary = patch.artifactSummary as
        | { resultIdentities?: { templateInstanceName?: string } }
        | undefined;
      return Boolean(summary?.resultIdentities?.templateInstanceName);
    });
    expect(persistedIdentity).toBe(false);

    // Run 2 resumes with the submitted value, allocates fresh, and a partial
    // apply failure must delete this run's resources — not preserve them as
    // if the identity had been inherited.
    await runTemplateTask({ submittedInputValues: { API_KEY: "value" } });

    expect(eventKinds).not.toContain("deployment_task.result_identity_reused");
    const kinds = deleteCalls().map((call) => deletedKind(call.url));
    expect(kinds).toContain("persistentvolumeclaims");
    expect(eventKinds).toContain("deployment_task.template_cleanup_started");
    expect(failCalls).toHaveLength(1);
    expect(attachedFailureDetails().stage).toBe("apply");
  });
});
