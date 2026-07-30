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
  buildGatewayPrompt: () => "deploy",
  buildGatewayRepairPrompt: () => "repair",
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

const { CodexGatewayTimeoutError, runDeployTaskGateway } = requireModule(
  "./gateway"
) as typeof import("./gateway");

function gatewayState(activeTurn: boolean) {
  return {
    activeTurn,
    cwd: "/home/devbox/project",
    ready: true,
    recentEvents: [],
    transcript: [],
  };
}

function sessionResponse(activeTurn: boolean): Response {
  return Response.json({
    ok: true,
    sessionId: "session-test-1",
    state: gatewayState(activeTurn),
  });
}

function task(): DeployTaskRow {
  return {
    id: "task-gateway-test",
    namespace: "ns-test",
    runner: { kind: "ai" },
    source: { kind: "prompt", prompt: "deploy" },
    status: "running",
  } as unknown as DeployTaskRow;
}

function installGatewayFetch(input: {
  interruptStatus?: number;
  interruptStatuses?: number[];
  onState?: () => void;
  stateActiveSequence?: boolean[];
  stateActive: boolean;
  turnError?: Error;
}): string[] {
  const paths: string[] = [];
  let interruptAttempt = 0;
  let stateRead = 0;
  globalThis.fetch = ((
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
      return sessionResponse(false);
    }
    if (url.pathname.endsWith("/turn") && request.method === "POST") {
      if (input.turnError != null) {
        throw input.turnError;
      }
      return sessionResponse(true);
    }
    if (url.pathname.endsWith("/state")) {
      input.onState?.();
      return sessionResponse(
        input.stateActiveSequence?.[stateRead++] ?? input.stateActive
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
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
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
});
