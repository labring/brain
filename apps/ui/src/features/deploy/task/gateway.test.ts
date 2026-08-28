import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from "bun:test";
import { createRequire } from "node:module";

import type { DeployTaskRow } from "./schema";

const requireModule = createRequire(import.meta.url);
const originalFetch = globalThis.fetch;
const originalWarn = console.warn;
let runController = new AbortController();
const recordedEvents: Array<{ kind: string }> = [];
let updateDeployTaskStateImpl: () => Promise<void> = () => Promise.resolve();

mock.module("server-only", () => ({}));
const realRunnerWrites = requireModule("./runner-writes");
mock.module("./gateway-prompt", () => ({
  buildManagedGatewayPrompt: (input: { resumeMode: string }) =>
    `managed:${input.resumeMode}`,
}));
mock.module("./runner-writes", () => ({
  deployTaskRunSignal: () => runController.signal,
  recordDeployTaskEvent: (_taskId: string, event: { kind: string }) => {
    recordedEvents.push(event);
    return Promise.resolve();
  },
  throwIfDeployTaskAborted: () => runController.signal.throwIfAborted(),
  updateDeployTaskState: () => updateDeployTaskStateImpl(),
}));

const {
  CodexGatewayApiError,
  CodexGatewayTimeoutError,
  CodexGatewayTurnError,
  DEPLOY_GATEWAY_MODEL,
  resolveDeployGatewayModel,
  runDeployTaskGateway: runDeployTaskGatewayRaw,
} = requireModule("./gateway") as typeof import("./gateway");
const originalGithubDeployModel = process.env.GITHUB_DEPLOY_MODEL;
const originalCodexGatewayModel = process.env.CODEX_GATEWAY_MODEL;

function runDeployTaskGateway(
  input: Omit<Parameters<typeof runDeployTaskGatewayRaw>[0], "resumeMode"> & {
    resumeMode?: Parameters<typeof runDeployTaskGatewayRaw>[0]["resumeMode"];
  }
) {
  return runDeployTaskGatewayRaw({
    ...input,
    resumeMode: input.resumeMode ?? "initial",
  });
}

function gatewayState(
  activeTurn: boolean,
  lastTurnStatus: string | null = activeTurn ? "inProgress" : "completed"
) {
  return {
    activeTurn,
    cwd: "/home/devbox/project",
    lastTurnStatus,
    ready: true,
    recentEvents: [],
    transcript: [],
  };
}

function sessionResponse(
  activeTurn: boolean,
  sessionId = "session-test-1",
  lastTurnStatus: string | null = activeTurn ? "inProgress" : "completed"
): Response {
  return Response.json({
    ok: true,
    sessionId,
    state: gatewayState(activeTurn, lastTurnStatus),
  });
}

function task(input?: {
  gatewaySessionId?: string | null;
  gatewayThreadId?: string | null;
}): DeployTaskRow {
  return {
    agentProtocol: "mcp-v1",
    gatewaySessionId: input?.gatewaySessionId ?? null,
    gatewayThreadId: input?.gatewayThreadId ?? null,
    id: "task-gateway-test",
    namespace: "ns-test",
    runner: { kind: "ai" },
    source: { kind: "prompt", prompt: "deploy" },
    status: "running",
  } as unknown as DeployTaskRow;
}

function installGatewayFetch(input: {
  createdSessionId?: string;
  interruptStatus?: number;
  interruptStatuses?: number[];
  onState?: () => void;
  prompts?: string[];
  sessionBodies?: Record<string, unknown>[];
  sessionHeaders?: Record<string, string>[];
  stateActiveSequence?: boolean[];
  stateActive: boolean;
  stateOmitLastTurnStatus?: boolean;
  stateResponseDelayMs?: number[];
  stateStatuses?: number[];
  stateTurnStatus?: string | null;
  stateTurnStatusSequence?: Array<string | null>;
  turnError?: Error;
}): string[] {
  const paths: string[] = [];
  let interruptAttempt = 0;
  let stateRead = 0;
  globalThis.fetch = (async (
    requestInput: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1]
  ) => {
    const request = new Request(requestInput, init);
    const url = new URL(request.url);
    paths.push(`${request.method} ${url.pathname}`);

    if (url.pathname === "/healthz") {
      return Response.json({ ok: true });
    }
    if (url.pathname === "/readyz") {
      return Response.json({ ok: true });
    }
    if (url.pathname === "/api/sessions" && request.method === "POST") {
      if (input.sessionBodies != null) {
        input.sessionBodies.push(
          JSON.parse(String(init?.body)) as Record<string, unknown>
        );
      }
      if (input.sessionHeaders != null) {
        input.sessionHeaders.push(
          Object.fromEntries(request.headers.entries()) as Record<
            string,
            string
          >
        );
      }
      return sessionResponse(false, input.createdSessionId);
    }
    if (url.pathname.endsWith("/turn") && request.method === "POST") {
      if (input.turnError != null) {
        throw input.turnError;
      }
      if (input.prompts != null) {
        const body = JSON.parse(String(init?.body)) as { prompt?: unknown };
        if (typeof body.prompt === "string") {
          input.prompts.push(body.prompt);
        }
      }
      return sessionResponse(true);
    }
    if (url.pathname.endsWith("/state")) {
      input.onState?.();
      const readIndex = stateRead++;
      const delayMs = input.stateResponseDelayMs?.[readIndex] ?? 0;
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      const status = input.stateStatuses?.[readIndex] ?? 200;
      if (status !== 200) {
        return Response.json({ error: "state unavailable" }, { status });
      }
      const activeTurn =
        input.stateActiveSequence?.[readIndex] ?? input.stateActive;
      if (input.stateOmitLastTurnStatus) {
        const { lastTurnStatus: _lastTurnStatus, ...state } =
          gatewayState(activeTurn);
        return Response.json({
          ok: true,
          sessionId: "session-test-1",
          state,
        });
      }
      return sessionResponse(
        activeTurn,
        "session-test-1",
        input.stateTurnStatusSequence?.[readIndex] ??
          input.stateTurnStatus ??
          (activeTurn ? "inProgress" : "completed")
      );
    }
    if (url.pathname.endsWith("/turn/interrupt")) {
      const status =
        input.interruptStatuses?.[interruptAttempt++] ??
        input.interruptStatus ??
        200;
      return status === 200
        ? sessionResponse(false)
        : Response.json({ error: "interrupt failed" }, { status });
    }
    return Response.json({ error: "unexpected request" }, { status: 500 });
  }) as unknown as typeof fetch;
  return paths;
}

describe("deployment Codex gateway interruption", () => {
  beforeEach(() => {
    runController = new AbortController();
    recordedEvents.length = 0;
    updateDeployTaskStateImpl = () => Promise.resolve();
    console.warn = () => undefined;
    delete process.env.GITHUB_DEPLOY_MODEL;
    delete process.env.CODEX_GATEWAY_MODEL;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
    delete process.env.GITHUB_DEPLOY_MODEL;
    delete process.env.CODEX_GATEWAY_MODEL;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
    if (originalGithubDeployModel === undefined) {
      delete process.env.GITHUB_DEPLOY_MODEL;
    } else {
      process.env.GITHUB_DEPLOY_MODEL = originalGithubDeployModel;
    }
    if (originalCodexGatewayModel === undefined) {
      delete process.env.CODEX_GATEWAY_MODEL;
    } else {
      process.env.CODEX_GATEWAY_MODEL = originalCodexGatewayModel;
    }
    mock.module("./runner-writes", () => ({ ...realRunnerWrites }));
  });

  it("does not interrupt a turn that completed normally", async () => {
    const paths = installGatewayFetch({ stateActive: false });

    await runDeployTaskGateway({
      context: { authToken: "gateway-token", url: "https://gateway.test" },
      deadlineAtMs: Date.now() + 1000,
      task: task(),
    });

    expect(paths.some((path) => path.endsWith("/turn/interrupt"))).toBe(false);
    expect(
      recordedEvents.some((event) => event.kind.includes("interrupted"))
    ).toBe(false);
  });

  it("accepts a settled turn when an older gateway omits lastTurnStatus", async () => {
    const paths = installGatewayFetch({
      stateActive: false,
      stateOmitLastTurnStatus: true,
    });

    await runDeployTaskGateway({
      context: { authToken: "gateway-token", url: "https://gateway.test" },
      deadlineAtMs: Date.now() + 1000,
      task: task(),
    });

    expect(paths.some((path) => path.endsWith("/turn/interrupt"))).toBe(false);
    expect(
      recordedEvents.some(
        (event) => event.kind === "deploy_task.gateway_turn_completed"
      )
    ).toBe(true);
  });

  it("rejects a failed terminal turn without opening a completion-required turn", async () => {
    const paths = installGatewayFetch({
      stateActive: false,
      stateTurnStatus: "failed",
    });

    await expect(
      runDeployTaskGateway({
        context: { authToken: "gateway-token", url: "https://gateway.test" },
        deadlineAtMs: Date.now() + 1000,
        task: task(),
      })
    ).rejects.toBeInstanceOf(CodexGatewayTurnError);

    expect(paths.some((path) => path.endsWith("/turn/interrupt"))).toBe(false);
    expect(
      recordedEvents.some(
        (event) => event.kind === "deploy_task.gateway_turn_completed"
      )
    ).toBe(false);
  });

  it("reuses the Task gateway session and returns its identifier", async () => {
    const paths = installGatewayFetch({ stateActive: false });

    const sessionId = await runDeployTaskGateway({
      context: { authToken: "gateway-token", url: "https://gateway.test" },
      deadlineAtMs: Date.now() + 1000,
      task: task({ gatewaySessionId: "session-existing-1" }),
    });

    expect(sessionId).toBe("session-existing-1");
    expect(paths).toContain("GET /api/sessions/session-existing-1/state");
    expect(paths).toContain("POST /api/sessions/session-existing-1/turn");
    expect(paths).not.toContain("POST /api/sessions");
    expect(
      recordedEvents.some(
        (event) => event.kind === "deploy_task.gateway_session_resumed"
      )
    ).toBe(true);
  });

  it("waits for an active resumed turn instead of submitting a concurrent turn", async () => {
    const paths = installGatewayFetch({
      stateActive: false,
      stateActiveSequence: [true, false],
    });

    const sessionId = await runDeployTaskGateway({
      context: { authToken: "gateway-token", url: "https://gateway.test" },
      deadlineAtMs: Date.now() + 5000,
      task: task({ gatewaySessionId: "session-active-1" }),
    });

    expect(sessionId).toBe("session-active-1");
    expect(paths).not.toContain("POST /api/sessions/session-active-1/turn");
    expect(
      recordedEvents.some(
        (event) => event.kind === "deploy_task.gateway_turn_completed"
      )
    ).toBe(true);
  });

  it("prefers an explicit existing session over the Task session", async () => {
    const paths = installGatewayFetch({ stateActive: false });

    const sessionId = await runDeployTaskGateway({
      context: { authToken: "gateway-token", url: "https://gateway.test" },
      deadlineAtMs: Date.now() + 1000,
      existingSessionId: "session-explicit-1",
      task: task({ gatewaySessionId: "session-task-1" }),
    });

    expect(sessionId).toBe("session-explicit-1");
    expect(paths).toContain("GET /api/sessions/session-explicit-1/state");
    expect(paths).not.toContain("GET /api/sessions/session-task-1/state");
  });

  for (const missingStatus of [404, 410]) {
    it(`creates a replacement session when state returns ${missingStatus}`, async () => {
      const paths = installGatewayFetch({
        createdSessionId: "session-replacement-1",
        stateActive: false,
        stateStatuses: [missingStatus, 200],
      });

      const sessionId = await runDeployTaskGateway({
        context: { authToken: "gateway-token", url: "https://gateway.test" },
        deadlineAtMs: Date.now() + 1000,
        task: task({
          gatewaySessionId: "session-missing-1",
          gatewayThreadId: "thread-replacement-1",
        }),
      });

      expect(sessionId).toBe("session-replacement-1");
      expect(paths).toContain("POST /api/sessions");
      expect(paths).toContain("POST /api/sessions/session-replacement-1/turn");
    });
  }

  it("does not replace a session on non-missing state errors", async () => {
    const paths = installGatewayFetch({
      stateActive: false,
      stateStatuses: [503],
    });

    let thrown: unknown;
    try {
      await runDeployTaskGateway({
        context: { authToken: "gateway-token", url: "https://gateway.test" },
        deadlineAtMs: Date.now() + 1000,
        task: task({ gatewaySessionId: "session-unavailable-1" }),
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(CodexGatewayApiError);
    expect((thrown as InstanceType<typeof CodexGatewayApiError>).status).toBe(
      503
    );
    expect(paths).not.toContain("POST /api/sessions");
  });

  it("uses the same managed turn prompt for created and resumed sessions", async () => {
    const createdPrompts: string[] = [];
    const resumedPrompts: string[] = [];
    installGatewayFetch({ prompts: createdPrompts, stateActive: false });
    await runDeployTaskGateway({
      context: { authToken: "gateway-token", url: "https://gateway.test" },
      deadlineAtMs: Date.now() + 1000,
      resumeMode: "input-submitted",
      task: task(),
    });

    installGatewayFetch({ prompts: resumedPrompts, stateActive: false });
    await runDeployTaskGateway({
      context: { authToken: "gateway-token", url: "https://gateway.test" },
      deadlineAtMs: Date.now() + 1000,
      resumeMode: "input-submitted",
      task: task({ gatewaySessionId: "session-existing-1" }),
    });

    expect(createdPrompts).toEqual(["managed:input-submitted"]);
    expect(resumedPrompts).toEqual(createdPrompts);
  });

  it("interrupts once on turn timeout and preserves the timeout error", async () => {
    const paths = installGatewayFetch({
      interruptStatus: 500,
      stateActive: true,
    });

    const result = runDeployTaskGateway({
      context: { authToken: "gateway-token", url: "https://gateway.test" },
      deadlineAtMs: Date.now() + 25,
      task: task(),
    });

    await expect(result).rejects.toBeInstanceOf(CodexGatewayTimeoutError);
    expect(
      paths.filter((path) => path.endsWith("/turn/interrupt"))
    ).toHaveLength(1);
    expect(
      recordedEvents.some(
        (event) => event.kind === "deploy_task.gateway_interrupt_failed"
      )
    ).toBe(true);
  });

  it("preserves timeout when the deadline interrupt settles during a state poll", async () => {
    const paths = installGatewayFetch({
      stateActive: false,
      stateResponseDelayMs: [50],
      stateTurnStatus: "interrupted",
    });

    await expect(
      runDeployTaskGateway({
        context: { authToken: "gateway-token", url: "https://gateway.test" },
        deadlineAtMs: Date.now() + 25,
        task: task(),
      })
    ).rejects.toBeInstanceOf(CodexGatewayTimeoutError);

    expect(
      paths.filter((path) => path.endsWith("/turn/interrupt"))
    ).toHaveLength(1);
  });

  it("retries a 409 while the turn is still active", async () => {
    const paths = installGatewayFetch({
      interruptStatuses: [409, 200],
      stateActive: true,
    });

    await expect(
      runDeployTaskGateway({
        context: { authToken: "gateway-token", url: "https://gateway.test" },
        deadlineAtMs: Date.now() + 25,
        task: task(),
      })
    ).rejects.toBeInstanceOf(CodexGatewayTimeoutError);

    expect(
      paths.filter((path) => path.endsWith("/turn/interrupt"))
    ).toHaveLength(2);
    expect(
      recordedEvents.some(
        (event) => event.kind === "deploy_task.gateway_interrupt_requested"
      )
    ).toBe(true);
  });

  it("does not treat inactive state as settled when turn submission is uncertain", async () => {
    const paths = installGatewayFetch({
      interruptStatuses: [409, 200],
      stateActive: false,
      stateActiveSequence: [false],
      turnError: new TypeError("turn response lost"),
    });

    await expect(
      runDeployTaskGateway({
        context: { authToken: "gateway-token", url: "https://gateway.test" },
        deadlineAtMs: Date.now() + 1000,
        task: task(),
      })
    ).rejects.toThrow("turn response lost");

    expect(
      paths.filter((path) => path.endsWith("/turn/interrupt"))
    ).toHaveLength(2);
    expect(
      recordedEvents.some(
        (event) => event.kind === "deploy_task.gateway_interrupt_requested"
      )
    ).toBe(true);
  });

  it("interrupts once on cancellation and rethrows the original abort", async () => {
    const cancelled = new Error("cancelled");
    const paths = installGatewayFetch({
      onState: () => runController.abort(cancelled),
      stateActive: true,
    });

    let thrown: unknown;
    try {
      await runDeployTaskGateway({
        context: { authToken: "gateway-token", url: "https://gateway.test" },
        deadlineAtMs: Date.now() + 1000,
        task: task(),
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(cancelled);
    expect(
      paths.filter((path) => path.endsWith("/turn/interrupt"))
    ).toHaveLength(1);
  });

  it("interrupts on cancellation while the turn state write is blocked", async () => {
    const cancelled = new Error("cancelled during state write");
    let releaseStateWrite!: () => void;
    const blockedStateWrite = new Promise<void>((resolve) => {
      releaseStateWrite = resolve;
    });
    let stateWriteStarted!: () => void;
    const stateWriteStart = new Promise<void>((resolve) => {
      stateWriteStarted = resolve;
    });
    let updateCount = 0;
    updateDeployTaskStateImpl = () => {
      updateCount += 1;
      if (updateCount === 3) {
        stateWriteStarted();
        return blockedStateWrite;
      }
      return Promise.resolve();
    };
    let interruptRequested!: () => void;
    const interruptRequest = new Promise<void>((resolve) => {
      interruptRequested = resolve;
    });
    const paths = installGatewayFetch({
      stateActive: true,
    });
    const fetchWithInterruptSignal = globalThis.fetch;
    globalThis.fetch = ((requestInput, init) => {
      const request = new Request(requestInput, init);
      if (new URL(request.url).pathname.endsWith("/turn/interrupt")) {
        interruptRequested();
      }
      return fetchWithInterruptSignal(request);
    }) as typeof fetch;

    const pending = runDeployTaskGateway({
      context: { authToken: "gateway-token", url: "https://gateway.test" },
      deadlineAtMs: Date.now() + 1000,
      task: task(),
    });
    await stateWriteStart;
    runController.abort(cancelled);
    await interruptRequest;

    expect(
      paths.filter((path) => path.endsWith("/turn/interrupt"))
    ).toHaveLength(1);

    releaseStateWrite();
    await expect(pending).rejects.toBe(cancelled);
    expect(
      paths.filter((path) => path.endsWith("/turn/interrupt"))
    ).toHaveLength(1);
  });

  it("creates a standard session without a Gateway deployment profile", async () => {
    const sessionBodies: Record<string, unknown>[] = [];
    const sessionHeaders: Record<string, string>[] = [];
    installGatewayFetch({
      sessionBodies,
      sessionHeaders,
      stateActive: false,
    });

    await runDeployTaskGateway({
      context: { authToken: "gateway-token", url: "https://gateway.test" },
      deadlineAtMs: Date.now() + 1000,
      task: task(),
    });

    expect(sessionBodies).toHaveLength(1);
    expect(sessionBodies[0]?.model).toBe(DEPLOY_GATEWAY_MODEL);
    expect(sessionBodies[0]?.toolProfile).toBeUndefined();
    expect(sessionBodies[0]?.threadId).toBeUndefined();
    expect(sessionHeaders[0]?.["x-sealai-control-token"]).toBeUndefined();
  });

  it("uses GITHUB_DEPLOY_MODEL for a new session when it is set", async () => {
    process.env.GITHUB_DEPLOY_MODEL = "  gpt-custom-deploy  ";
    const sessionBodies: Record<string, unknown>[] = [];
    installGatewayFetch({
      sessionBodies,
      stateActive: false,
    });

    await runDeployTaskGateway({
      context: { authToken: "gateway-token", url: "https://gateway.test" },
      deadlineAtMs: Date.now() + 1000,
      task: task(),
    });

    expect(sessionBodies[0]?.model).toBe("gpt-custom-deploy");
  });

  it("treats a blank GITHUB_DEPLOY_MODEL as unset", () => {
    process.env.GITHUB_DEPLOY_MODEL = "   ";
    expect(resolveDeployGatewayModel()).toBe(DEPLOY_GATEWAY_MODEL);
  });

  it("ignores CODEX_GATEWAY_MODEL when resolving the deploy session model", () => {
    process.env.CODEX_GATEWAY_MODEL = "gpt-chat-only";
    expect(resolveDeployGatewayModel()).toBe(DEPLOY_GATEWAY_MODEL);
    process.env.GITHUB_DEPLOY_MODEL = "gpt-custom-deploy";
    expect(resolveDeployGatewayModel()).toBe("gpt-custom-deploy");
  });

  it("resumes the recorded Codex Thread when a session is lost", async () => {
    const sessionBodies: Record<string, unknown>[] = [];
    installGatewayFetch({
      sessionBodies,
      stateActive: false,
      stateStatuses: [404, 200],
    });

    await runDeployTaskGateway({
      context: { authToken: "gateway-token", url: "https://gateway.test" },
      deadlineAtMs: Date.now() + 1000,
      task: task({
        gatewaySessionId: "session-lost-1",
        gatewayThreadId: "thread-resume-1",
      }),
    });

    expect(sessionBodies[0]?.threadId).toBe("thread-resume-1");
  });

  it("fails closed when both the session and Thread are unavailable", async () => {
    installGatewayFetch({
      stateActive: false,
      stateStatuses: [404],
    });

    await expect(
      runDeployTaskGateway({
        context: { authToken: "gateway-token", url: "https://gateway.test" },
        deadlineAtMs: Date.now() + 1000,
        task: task({ gatewaySessionId: "session-lost-2" }),
      })
    ).rejects.toMatchObject({ status: 409 });
  });
});
