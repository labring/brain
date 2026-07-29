import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { createRequire } from "node:module";
import YAML from "yaml";

import type { DeployTaskHandle } from "./engine/handle";
import {
  CURRENT_AI_ARTIFACT_PUBLIC_PROJECTION_VERSION,
  CURRENT_AI_BLOCKING_INPUT_PUBLIC_PROJECTION_VERSION,
  type DeploymentTaskDeploymentPlan,
  type DeployTaskBlockingInput,
  type DeployTaskRow,
} from "./schema";
import type { DeploymentTaskTimelineSnapshot } from "./timeline";

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
const recordedEvents: Record<string, unknown>[] = [];
const requestInputsCalls: unknown[] = [];
const stateWrites: Record<string, unknown>[] = [];
const timelineEvents: Record<string, unknown>[] = [];
let projectedTimeline: DeploymentTaskTimelineSnapshot | null = null;

let currentRow: DeployTaskRow;
let deployTemplateInstanceImpl: () => Promise<{
  instanceName: string;
  resources: { name: string; resourceType: string }[];
}>;

const abortedController = new AbortController();
abortedController.abort();

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
const { deploymentTaskTimelineFromTaskRecord } = requireModule(
  "./timeline-storage"
) as typeof import("./timeline-storage");
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
  deployTaskRunSignal: () => abortedController.signal,
  recordDeployTaskEvent: (
    _taskId: string,
    event: { kind: string; [key: string]: unknown }
  ): Promise<void> => {
    eventKinds.push(event.kind);
    recordedEvents.push(event);
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
    input: {
      event?: Record<string, unknown>;
      update?: (
        timeline: DeploymentTaskTimelineSnapshot
      ) => DeploymentTaskTimelineSnapshot;
    }
  ) => {
    if (input.event != null) {
      timelineEvents.push(input.event);
    }
    if (input.update != null && projectedTimeline != null) {
      projectedTimeline = input.update(projectedTimeline);
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

const { persistableAiDeployOutput, runDeployTask } = requireModule(
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

function preparedAiTaskRow(input: {
  buildResult: Record<string, unknown>;
}): DeployTaskRow {
  const outputJson = {
    buildResult: input.buildResult,
    deliveryManifest: { args: {} },
    templateYaml: "apiVersion: app.sealos.io/v1\nkind: Template\n",
  };
  return {
    artifactSummary: {
      deploymentPlan: {
        args: {},
        inputs: [],
        kind: "sealos-template",
        templateName: "demo-web",
      },
      outputJson,
    },
    blockingInputs: [],
    githubConnectionId: null,
    id: "task-1",
    namespace: "ns-demo",
    phase: "configure",
    projectId: "proj-1",
    projectName: "proj-1",
    runner: { kind: "ai" },
    source: { kind: "prompt", text: "deploy this app" },
    status: "running",
    target: { kind: "existingProject", projectId: "proj-1" },
    timelineSnapshot: null,
    updatedAt: new Date("2026-07-22T00:00:00.000Z"),
  } as unknown as DeployTaskRow;
}

function aiTaskWithCompletePlanAndInvalidOutput(): DeployTaskRow {
  return {
    artifactSummary: {
      deploymentPlan: {
        args: {},
        inputs: [
          {
            key: "PORT",
            label: "Port",
            required: false,
            sensitive: false,
            type: "string",
          },
        ],
        kind: "sealos-template",
        templateName: "demo",
      },
      outputJson: {
        deliveryManifest: { args: {} },
        templateYaml: "apiVersion: app.sealos.io/v1\nkind: Template\n",
      },
    },
    blockingInputs: [],
    githubConnectionId: null,
    id: "task-1",
    namespace: "ns-demo",
    phase: "configure",
    projectId: "proj-1",
    projectName: "proj-1",
    runner: { kind: "ai", runtimeProvider: "devbox" },
    source: { kind: "prompt", text: "deploy demo" },
    status: "running",
    target: { kind: "existingProject", projectId: "proj-1" },
    timelineSnapshot: null,
    updatedAt: new Date("2026-07-22T00:00:00.000Z"),
  } as unknown as DeployTaskRow;
}

const AI_TEMPLATE_WITH_CONFIG_INPUTS = `
apiVersion: app.sealos.io/v1
kind: Template
metadata:
  name: demo
spec:
  title: Demo
  templateType: inline
  inputs:
    PORT:
      label: Port
      required: true
      type: number
    API_KEY:
      label: API key
      required: true
      type: secret
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: demo-config
data:
  port: "\${{ inputs.PORT }}"
  api-key: "\${{ inputs.API_KEY }}"
`;

const AI_TEMPLATE_WITH_CONFIG_INPUTS_AND_WORKLOAD = `${AI_TEMPLATE_WITH_CONFIG_INPUTS}
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: demo-api
spec:
  replicas: 1
  selector:
    matchLabels:
      app: demo-api
  template:
    metadata:
      labels:
        app: demo-api
    spec:
      containers:
        - env:
            - name: API_KEY
              value: "\${{ inputs.API_KEY }}"
          image: nginx:1.27
          name: demo-api
`;

const AI_TEMPLATE_WITH_INVALID_SENSITIVE_DEFAULT = `
apiVersion: app.sealos.io/v1
kind: Template
metadata:
  name: demo
spec:
  title: Demo
  templateType: inline
  inputs:
    API_KEY:
      default: ai-authored-invalid-default
      label: API key
      required: true
      type: number
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: demo-config
data:
  api-key: "\${{ inputs.API_KEY }}"
`;

const AI_TEMPLATE_WITH_SECRET_RESOURCE_NAME = `
apiVersion: app.sealos.io/v1
kind: Template
metadata:
  name: demo
spec:
  title: Demo
  templateType: inline
  inputs:
    API_KEY:
      label: API key
      required: true
      type: secret
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-\${{ inputs.API_KEY }}
data:
  ready: "true"
`;

const AI_CURRENT_BLOCKING_INPUTS = {
  API_KEY: {
    id: "API_KEY",
    key: "API_KEY",
    label: "API key",
    publicProjectionVersion:
      CURRENT_AI_BLOCKING_INPUT_PUBLIC_PROJECTION_VERSION,
    required: true,
    sensitive: true,
    type: "secret",
    valueType: "secret",
  },
  PORT: {
    id: "PORT",
    key: "PORT",
    label: "Port",
    publicProjectionVersion:
      CURRENT_AI_BLOCKING_INPUT_PUBLIC_PROJECTION_VERSION,
    required: true,
    sensitive: false,
    type: "env",
    valueType: "number",
  },
} satisfies Record<string, DeployTaskBlockingInput>;

function currentAiBlockingInputs(
  ...keys: Array<keyof typeof AI_CURRENT_BLOCKING_INPUTS>
): DeployTaskBlockingInput[] {
  return keys.map((key) => ({ ...AI_CURRENT_BLOCKING_INPUTS[key] }));
}

function preparedAiInputTaskRow(input?: {
  missingInputKeys?: string[];
  planArgs?: Record<string, string>;
  planInputs?: DeploymentTaskDeploymentPlan["inputs"];
  templateYaml?: string;
  trustedPublicProjection?: boolean;
}): DeployTaskRow {
  const planArgs = input?.planArgs ?? {};
  return {
    artifactSummary: {
      deploymentPlan: {
        args: planArgs,
        inputs: input?.planInputs ?? [
          {
            key: "PORT",
            label: "Port",
            required: true,
            sensitive: false,
            type: "number",
          },
          {
            key: "API_KEY",
            label: "API key",
            required: true,
            sensitive: true,
            type: "secret",
          },
        ],
        kind: "sealos-template",
        missingInputKeys: input?.missingInputKeys ?? ["PORT", "API_KEY"],
        templateName: "demo",
      },
      outputJson: {
        buildResult: { status: "skipped" },
        deliveryManifest: { args: planArgs },
        templateYaml: input?.templateYaml ?? AI_TEMPLATE_WITH_CONFIG_INPUTS,
      },
      ...(input?.trustedPublicProjection === false
        ? {}
        : {
            publicProjectionVersion:
              CURRENT_AI_ARTIFACT_PUBLIC_PROJECTION_VERSION,
          }),
    },
    blockingInputs: [],
    githubConnectionId: null,
    id: "task-1",
    namespace: "ns-demo",
    phase: "configure",
    projectId: "proj-1",
    projectName: "proj-1",
    runner: { kind: "ai", runtimeProvider: "devbox" },
    source: { kind: "prompt", text: "deploy demo" },
    status: "running",
    target: { kind: "existingProject", projectId: "proj-1" },
    timelineSnapshot: null,
    updatedAt: new Date("2026-07-22T00:00:00.000Z"),
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
    recordedEvents.length = 0;
    requestInputsCalls.length = 0;
    stateWrites.length = 0;
    timelineEvents.length = 0;
    projectedTimeline = null;
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

  it("fails malformed AI artifacts instead of re-blocking a complete input plan", async () => {
    currentRow = aiTaskWithCompletePlanAndInvalidOutput();

    await runDeployTask(runnerHandle(), {
      currentBlockingInputs: currentAiBlockingInputs("PORT", "API_KEY"),
      encodedKubeconfig: "kubeconfig-for-tests",
      submittedInputValues: { PORT: "8080" },
      taskId: currentRow.id,
    });

    expect(requestInputsCalls).toHaveLength(0);
    expect(failCalls).toHaveLength(1);
    expect(attachedFailureDetails().reason).toBe("unknown");
    expect(JSON.stringify(failCalls[0])).not.toContain(
      "did not include buildResult"
    );
    const timelineFailure = timelineEvents.find(
      (event) => event.kind === "deployment_task.failed"
    );
    expect(timelineFailure?.phase).toBe("configure");
    expect(timelineFailure?.payload).toEqual({});
  });
});

describe("AI prepared output failure handling", () => {
  beforeEach(() => {
    installFetchRecorder();
    fetchCalls.length = 0;
    failCalls.length = 0;
    completeCalls.length = 0;
    eventKinds.length = 0;
    recordedEvents.length = 0;
    requestInputsCalls.length = 0;
    stateWrites.length = 0;
    timelineEvents.length = 0;
    projectedTimeline = null;
    process.env.DIRECT_AP_READINESS_TIMEOUT_MS = "1";
  });

  it("scrubs hidden secret args and default echoes from persisted AI output", () => {
    const templateYaml = `
apiVersion: app.sealos.io/v1
kind: Template
metadata:
  name: private-output
spec:
  templateType: inline
  defaults:
    app_host:
      value: demo
    internal_token:
      type: secret
      value: private-global-default
  inputs:
    enabled:
      default: "false"
      type: boolean
    credential:
      default: private-input-default
      if: inputs.enabled == "true"
      options:
        - private-input-default
      type: secret
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: private-output
data:
  host: \${{ defaults.app_host }}
`;
    const deliveryManifest = {
      args: {
        credential: "provider-secret-token",
        enabled: "false",
      },
    };
    const persisted = persistableAiDeployOutput({
      deliveryManifest,
      output: {
        buildResult: {
          detail:
            "provider-secret-token private-input-default private-global-default",
          status: "skipped",
        },
        deliveryManifest,
        templateYaml,
      },
      planInputs: [{ key: "enabled", sensitive: false, type: "boolean" }],
    });
    const serialized = JSON.stringify({
      deliveryManifest: persisted.deliveryManifest,
      outputJson: persisted.outputJson,
    });
    const persistedTemplate = YAML.parseAllDocuments(
      (persisted.outputJson.templateYaml as string) ?? ""
    )[0]?.toJS() as {
      spec?: {
        defaults?: Record<string, unknown>;
        inputs?: Record<string, { default?: string; options?: string[] }>;
      };
    };

    expect(persisted.deliveryManifest.args).toEqual({ enabled: "false" });
    expect(serialized).not.toContain("provider-secret-token");
    expect(serialized).not.toContain("private-input-default");
    expect(serialized).not.toContain("private-global-default");
    expect(persistedTemplate.spec?.defaults?.app_host).toEqual({
      value: "demo",
    });
    expect(persistedTemplate.spec?.defaults?.internal_token).toBeUndefined();
    expect(persistedTemplate.spec?.inputs?.credential?.default).toBeUndefined();
    expect(persistedTemplate.spec?.inputs?.credential?.options).toBeUndefined();
  });

  it("rejects generated sensitive values that are too short to scrub safely", () => {
    const deliveryManifest = { args: { API_KEY: "q7" } };

    expect(() =>
      persistableAiDeployOutput({
        deliveryManifest,
        output: {
          buildResult: { status: "skipped" },
          deliveryManifest,
          templateYaml: AI_TEMPLATE_WITH_CONFIG_INPUTS,
        },
        planInputs: [
          {
            key: "API_KEY",
            sensitive: true,
            type: "secret",
          },
        ],
      })
    ).toThrow("sensitive value shorter than four characters");
  });

  it("rejects a resumable template that still embeds a submitted secret", () => {
    const secret = "provider-secret-token";
    const deliveryManifest = { args: { API_KEY: secret } };

    expect(() =>
      persistableAiDeployOutput({
        deliveryManifest,
        output: {
          buildResult: { status: "skipped" },
          deliveryManifest,
          templateYaml: `
apiVersion: app.sealos.io/v1
kind: Template
metadata:
  name: unsafe-template
spec:
  defaults:
    generated_value:
      value: ${secret}
  inputs:
    API_KEY:
      type: secret
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: unsafe-template
data:
  value: safe
`,
        },
        planInputs: [{ key: "API_KEY", sensitive: true, type: "secret" }],
      })
    ).toThrow(
      "Generated deployment template contains a sensitive value outside a declared sensitive input."
    );
  });

  it("scrubs sensitive echoes from persisted plan text and ordinary options", async () => {
    const secret = "sensitive-plan-token";
    currentRow = preparedAiInputTaskRow({
      missingInputKeys: [],
      planInputs: [
        {
          description: `Uses ${secret}`,
          key: "PORT",
          label: `Port for ${secret}`,
          options: ["8080", secret],
          required: true,
          sensitive: false,
          type: "number",
        },
        {
          description: `Credential ${secret}`,
          key: "API_KEY",
          label: `API key ${secret}`,
          required: true,
          sensitive: true,
          type: "secret",
        },
      ],
    });

    await runDeployTask(runnerHandle(), {
      currentBlockingInputs: currentAiBlockingInputs("PORT", "API_KEY"),
      encodedKubeconfig: "kubeconfig-for-tests",
      submittedInputValues: { API_KEY: secret, PORT: "8080" },
      taskId: "task-1",
    });

    const persistedState = JSON.stringify({
      completeCalls,
      failCalls,
      recordedEvents,
      stateWrites,
      timelineEvents,
    });
    expect(
      stateWrites.some((patch) => {
        const summary = patch.artifactSummary as
          | { deploymentPlan?: unknown }
          | undefined;
        return summary?.deploymentPlan != null;
      })
    ).toBe(true);
    expect(persistedState).not.toContain(secret);
    expect(persistedState).toContain("[redacted]");
  });

  it("does not promote legacy prepared output to a trusted public projection", async () => {
    currentRow = preparedAiInputTaskRow({
      trustedPublicProjection: false,
    });

    await runDeployTask(runnerHandle(), {
      currentBlockingInputs: currentAiBlockingInputs("PORT", "API_KEY"),
      encodedKubeconfig: "kubeconfig-for-tests",
      submittedInputValues: {
        API_KEY: "submitted-secret",
        PORT: "8080",
      },
      taskId: "task-1",
    });

    const stampedWrite = stateWrites.some((patch) => {
      const summary = patch.artifactSummary as
        | { publicProjectionVersion?: number }
        | undefined;
      return summary?.publicProjectionVersion != null;
    });
    expect(stampedWrite).toBe(false);
  });

  it("keeps AI readiness provider errors out of persisted timeline state", async () => {
    process.env.API_URL = "https://api.test";
    currentRow = preparedAiInputTaskRow({
      templateYaml: AI_TEMPLATE_WITH_CONFIG_INPUTS_AND_WORKLOAD,
    });
    projectedTimeline = deploymentTaskTimelineFromTaskRecord(currentRow);

    await runDeployTask(runnerHandle(), {
      currentBlockingInputs: currentAiBlockingInputs("PORT", "API_KEY"),
      encodedKubeconfig: "kubeconfig-for-tests",
      submittedInputValues: {
        API_KEY: "submitted-secret",
        PORT: "8080",
      },
      taskId: "task-1",
    });

    expect(completeCalls).toHaveLength(0);
    expect(failCalls).toHaveLength(1);
    expect(attachedFailureDetails().reason).toBe("readiness-timeout");
    const persistedState = JSON.stringify({
      failCalls,
      projectedTimeline,
      recordedEvents,
      stateWrites,
      timelineEvents,
    });
    expect(persistedState).not.toContain("provider-secret-readiness-token");
    expect(persistedState).toContain("observation.");
  });

  it("re-blocks the complete input form when a submitted value is invalid", async () => {
    currentRow = preparedAiInputTaskRow();

    await runDeployTask(runnerHandle(), {
      currentBlockingInputs: currentAiBlockingInputs("PORT", "API_KEY"),
      encodedKubeconfig: "kubeconfig-for-tests",
      submittedInputValues: {
        API_KEY: "secret-that-must-not-persist",
        PORT: "invalid-port-that-must-not-persist",
      },
      taskId: "task-1",
    });

    expect(failCalls).toHaveLength(0);
    expect(requestInputsCalls).toHaveLength(1);
    const request = requestInputsCalls[0] as {
      blockingInputs: Array<{ key?: string }>;
      phase: string;
    };
    expect(request.phase).toBe("configure");
    expect(request.blockingInputs.map((item) => item.key)).toEqual([
      "PORT",
      "API_KEY",
    ]);
    const rejectedEvent = recordedEvents.find(
      (event) => event.kind === "deployment_task.input_rejected"
    );
    expect(rejectedEvent?.payload).toEqual({
      code: "number",
      inputKey: "PORT",
    });
    expect(JSON.stringify({ rejectedEvent, request })).not.toContain(
      "invalid-port-that-must-not-persist"
    );
    expect(JSON.stringify({ rejectedEvent, request })).not.toContain(
      "secret-that-must-not-persist"
    );
    expect(JSON.stringify(rejectedEvent)).not.toContain("must be a number");
  });

  it("re-blocks a submitted short secret without persisting its value", async () => {
    const shortSecret = "q7";
    currentRow = preparedAiInputTaskRow();

    await runDeployTask(runnerHandle(), {
      currentBlockingInputs: currentAiBlockingInputs("PORT", "API_KEY"),
      encodedKubeconfig: "kubeconfig-for-tests",
      submittedInputValues: { API_KEY: shortSecret, PORT: "8080" },
      taskId: "task-1",
    });

    expect(failCalls).toHaveLength(0);
    expect(requestInputsCalls).toHaveLength(1);
    const rejectedEvent = recordedEvents.find(
      (event) => event.kind === "deployment_task.input_rejected"
    );
    expect(rejectedEvent?.payload).toEqual({
      code: "minimum-length",
      inputKey: "API_KEY",
    });
    expect(
      JSON.stringify({
        recordedEvents,
        requestInputsCalls,
        stateWrites,
        timelineEvents,
      })
    ).not.toContain(shortSecret);
  });

  it("rejects sensitive resource names before apply or persistence", async () => {
    const secret = "private-resource-token";
    currentRow = preparedAiInputTaskRow({
      missingInputKeys: ["API_KEY"],
      planInputs: [
        {
          key: "API_KEY",
          label: "API key",
          required: true,
          sensitive: true,
          type: "secret",
        },
      ],
      templateYaml: AI_TEMPLATE_WITH_SECRET_RESOURCE_NAME,
    });

    await runDeployTask(runnerHandle(), {
      currentBlockingInputs: currentAiBlockingInputs("API_KEY"),
      encodedKubeconfig: "kubeconfig-for-tests",
      submittedInputValues: { API_KEY: secret },
      taskId: "task-1",
    });

    expect(requestInputsCalls).toHaveLength(0);
    expect(completeCalls).toHaveLength(0);
    expect(failCalls).toHaveLength(1);
    expect(fetchCalls.some((call) => call.method === "POST")).toBe(false);
    expect(
      JSON.stringify({
        failCalls,
        recordedEvents,
        stateWrites,
        timelineEvents,
      })
    ).not.toContain(secret);
  });

  it("fails an AI-authored invalid value outside the current submission", async () => {
    currentRow = preparedAiInputTaskRow({
      missingInputKeys: ["API_KEY"],
      planArgs: { PORT: "ai-authored-invalid-port" },
    });

    await runDeployTask(runnerHandle(), {
      currentBlockingInputs: currentAiBlockingInputs("API_KEY"),
      encodedKubeconfig: "kubeconfig-for-tests",
      submittedInputValues: {
        API_KEY: "secret-that-must-not-persist",
      },
      taskId: "task-1",
    });

    expect(requestInputsCalls).toHaveLength(0);
    expect(failCalls).toHaveLength(1);
    expect(recordedEvents).not.toContainEqual(
      expect.objectContaining({ kind: "deployment_task.input_rejected" })
    );
    expect(JSON.stringify(failCalls[0])).not.toContain(
      "ai-authored-invalid-port"
    );
    expect(JSON.stringify(failCalls[0])).not.toContain(
      "secret-that-must-not-persist"
    );
  });

  it("fails a submitted invalid value that is not a current blocking input", async () => {
    currentRow = preparedAiInputTaskRow({
      missingInputKeys: ["API_KEY"],
      planArgs: { PORT: "8080" },
    });

    await runDeployTask(runnerHandle(), {
      currentBlockingInputs: currentAiBlockingInputs("API_KEY"),
      encodedKubeconfig: "kubeconfig-for-tests",
      submittedInputValues: { PORT: "invalid-extra-port" },
      taskId: "task-1",
    });

    expect(requestInputsCalls).toHaveLength(0);
    expect(failCalls).toHaveLength(1);
    expect(recordedEvents).not.toContainEqual(
      expect.objectContaining({ kind: "deployment_task.input_rejected" })
    );
    expect(JSON.stringify(failCalls[0])).not.toContain("invalid-extra-port");
  });

  it("fails an AI-authored invalid default reached by an empty submission", async () => {
    currentRow = preparedAiInputTaskRow({
      missingInputKeys: [],
      planInputs: [
        {
          key: "API_KEY",
          label: "API key",
          required: true,
          sensitive: true,
          type: "number",
        },
      ],
      templateYaml: AI_TEMPLATE_WITH_INVALID_SENSITIVE_DEFAULT,
    });

    await runDeployTask(runnerHandle(), {
      currentBlockingInputs: currentAiBlockingInputs("API_KEY"),
      encodedKubeconfig: "kubeconfig-for-tests",
      submittedInputValues: { API_KEY: "" },
      taskId: "task-1",
    });

    expect(requestInputsCalls).toHaveLength(0);
    expect(failCalls).toHaveLength(1);
    expect(recordedEvents).not.toContainEqual(
      expect.objectContaining({ kind: "deployment_task.input_rejected" })
    );
    expect(JSON.stringify(failCalls[0])).not.toContain(
      "ai-authored-invalid-default"
    );
  });

  it("classifies a failed build result without persisting its raw error", async () => {
    currentRow = preparedAiTaskRow({
      buildResult: {
        error: { message: "private build output" },
        status: "failed",
      },
    });

    await runDeployTask(runnerHandle(), {
      encodedKubeconfig: "kubeconfig-for-tests",
      submittedInputValues: { TRIGGER: "apply" },
      taskId: "task-1",
    });

    expect(requestInputsCalls).toHaveLength(0);
    expect(completeCalls).toHaveLength(0);
    expect(failCalls).toHaveLength(1);
    expect(attachedFailureDetails().reason).toBe("image-build-failed");
    expect(JSON.stringify(failCalls[0])).not.toContain("private build output");
  });
});
