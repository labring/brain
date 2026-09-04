import { describe, expect, test } from "bun:test";
import {
  deployTaskDevMockProjection,
  deployTaskDevMockResponse,
  deployTaskDevMockTask,
} from "./dev-fixtures";
import {
  DEPLOY_TASK_DEV_SCENARIOS,
  deployTaskDevMockCookie,
  deployTaskDevMockTaskId,
} from "./dev-mock-cookie";
import { deploymentTaskProjectionIsVisible } from "./projection";

const NOW_MS = Date.parse("2026-08-28T10:00:00.000Z");

function request(path: string, scenario: string): Request {
  const req = new Request(`http://localhost${path}`);
  req.headers.set("cookie", `${deployTaskDevMockCookie.name}=${scenario}`);
  return req;
}

describe("deployment task dev fixtures", () => {
  for (const scenario of DEPLOY_TASK_DEV_SCENARIOS) {
    test(`${scenario} is a coherent task, timeline and projection`, () => {
      const snapshot = deployTaskDevMockTask(scenario, {
        namespace: "ns-test",
        nowMs: NOW_MS,
        projectId: "project-1",
      });
      expect(snapshot.task.id).toBe(deployTaskDevMockTaskId(scenario));
      expect(snapshot.timeline.taskId).toBe(snapshot.task.id);
      expect(snapshot.timeline.status).toBe(snapshot.task.status);
      expect(snapshot.timeline.steps.length).toBeGreaterThan(0);
      expect(snapshot.timeline.steps.map((step) => step.order)).toEqual([
        ...snapshot.timeline.steps.keys(),
      ]);
      const projection = deployTaskDevMockProjection(scenario, {
        namespace: "ns-test",
        nowMs: NOW_MS,
        projectId: "project-1",
      });
      expect(projection.id).toBe(snapshot.task.id);
      expect(projection.projectId).toBe("project-1");
      expect(projection.status).toBe(snapshot.task.status);
    });
  }

  test("an active task places itself on the canvas", () => {
    const projection = deployTaskDevMockProjection("running", {
      namespace: "ns-test",
      nowMs: NOW_MS,
      projectId: "project-1",
    });
    expect(
      deploymentTaskProjectionIsVisible(projection, new Date(NOW_MS))
    ).toBe(true);
  });

  test("blocked carries the inputs the pane asks for", () => {
    const { task } = deployTaskDevMockTask("blocked", {
      namespace: "ns-test",
      nowMs: NOW_MS,
      projectId: null,
    });
    expect(task.blockingInputs.length).toBeGreaterThan(0);
  });

  test("failed names a scrubbed failure reason", () => {
    const { task, timeline } = deployTaskDevMockTask("failed", {
      namespace: "ns-test",
      nowMs: NOW_MS,
      projectId: null,
    });
    expect(task.failureDetails?.reason).toBe("image-build-failed");
    expect(timeline.steps.at(-1)?.status).toBe("failed");
  });

  test("the timeline route answers only for the fixture task", async () => {
    const mocked = deployTaskDevMockResponse(
      "timeline",
      request("/api/deploy-tasks/x/timeline?namespace=ns-test", "succeeded"),
      deployTaskDevMockTaskId("succeeded")
    );
    expect(mocked?.status).toBe(200);
    const body = (await mocked?.json()) as { task: { status: string } };
    expect(body.task.status).toBe("completed");
    expect(
      deployTaskDevMockResponse(
        "timeline",
        request(
          "/api/deploy-tasks/real/timeline?namespace=ns-test",
          "succeeded"
        ),
        "real-task"
      )
    ).toBeNull();
  });

  test("the list answers with the fixture projection for the project", async () => {
    const mocked = deployTaskDevMockResponse(
      "list",
      request("/api/deploy-tasks?namespace=ns-test&projectId=p1", "failed"),
      null
    );
    const body = (await mocked?.json()) as { projections: { id: string }[] };
    expect(body.projections.map((item) => item.id)).toEqual([
      "mock-task-failed",
    ]);
  });

  test("the stream sends one snapshot frame and stays open", async () => {
    const controller = new AbortController();
    const req = new Request(
      "http://localhost/api/deploy-tasks/mock-task-running/timeline/stream?namespace=ns-test",
      { signal: controller.signal }
    );
    req.headers.set("cookie", `${deployTaskDevMockCookie.name}=running`);
    const mocked = deployTaskDevMockResponse(
      "timeline-stream",
      req,
      "mock-task-running"
    );
    expect(mocked?.headers.get("content-type")).toContain("text/event-stream");
    const reader = mocked?.body?.getReader();
    const first = await reader?.read();
    const text = new TextDecoder().decode(first?.value);
    expect(text.startsWith("event: snapshot\n")).toBe(true);
    expect(JSON.parse(text.split("data: ")[1] ?? "{}").type).toBe("snapshot");
    controller.abort();
    const last = await reader?.read();
    expect(last?.done).toBe(true);
  });

  test("off and invalid behave like every Dev Mock", () => {
    expect(
      deployTaskDevMockResponse(
        "list",
        request("/api/deploy-tasks?projectId=p1", "off:running"),
        null
      )
    ).toBeNull();
    const invalid = deployTaskDevMockResponse(
      "list",
      request("/api/deploy-tasks?projectId=p1", "nope"),
      null
    );
    expect(invalid?.status).toBe(500);
  });
});

describe("verified success fixtures (issue #160)", () => {
  const input = {
    namespace: "ns-test",
    nowMs: NOW_MS,
    projectId: "project-1",
  } as const;

  test("succeeded declares only what the AI runner can prove", () => {
    const { task, timeline } = deployTaskDevMockTask("succeeded", input);
    expect(timeline.status).toBe("completed");
    // The record is appended after the steps, so it owns the later revision
    // — the value the celebration's idempotency key is built from.
    expect(timeline.revision).toBe(timeline.steps.length + 1);
    expect(timeline.success?.revision).toBe(timeline.revision);
    expect(timeline.success?.productName).toBe("acme/web-app");
    expect(timeline.success?.entries).toEqual([
      {
        label: "Public address",
        protocol: "https",
        url: "https://web-app.mock.sealos.run",
      },
    ]);
    expect(timeline.success?.entries?.[0]?.url).toBe(
      task.resultUrl ?? undefined
    );
    expect(timeline.success?.verification).toEqual({ passed: 3, total: 3 });
    // Nothing was declared, so nothing is invented: the UI falls back for the
    // headline and leaves the guidance list out entirely.
    expect(timeline.success?.headline).toBeUndefined();
    expect(timeline.success?.guidance).toBeUndefined();
  });

  test("succeeded-eaglercraft teaches the player how to start playing", () => {
    const { timeline } = deployTaskDevMockTask("succeeded-eaglercraft", input);
    expect(timeline.success?.productName).toBe("EaglerCraft Server");
    expect(timeline.success?.headline).toBe("Your server is online");
    expect(timeline.success?.openActionLabel).toBe("Open server");
    expect(timeline.success?.entries).toEqual([
      {
        label: "Server address",
        protocol: "https",
        url: "https://eaglercraft-server.mock.sealos.run",
      },
    ]);
    expect(timeline.success?.guidance?.map((step) => step.label)).toEqual([
      "Open the EaglerCraft client in your browser.",
      "Go to Multiplayer and add a server.",
      "Paste the server address.",
      "Join the server and start playing.",
    ]);
    expect(timeline.success?.verification).toEqual({ passed: 2, total: 2 });
    // One declared address, exactly as the runner probed it. How the client
    // reaches the same host over WebSocket is a separate, open question and
    // must not be smuggled into a fixture.
    expect(JSON.stringify(timeline.success)).not.toContain("wss:");
  });

  test("no other scenario claims the product is usable", () => {
    for (const scenario of DEPLOY_TASK_DEV_SCENARIOS) {
      if (scenario.startsWith("succeeded")) {
        continue;
      }
      const { timeline } = deployTaskDevMockTask(scenario, input);
      expect(timeline.success).toBeUndefined();
    }
  });
});
describe("interruption fixtures (catalog E1/E2)", () => {
  test("failed-balance is a balance-exhausted task with its billing evidence and chip reason", () => {
    const { task } = deployTaskDevMockTask("failed-balance", {
      namespace: "ns-test",
      nowMs: NOW_MS,
      projectId: "project-1",
    });
    expect(task.status).toBe("failed");
    expect(task.failureDetails?.reason).toBe("balance-exhausted");
    expect(task.failureDetails?.billingEvidence?.kind).toBe("account-debt");
    expect(
      deployTaskDevMockProjection("failed-balance", {
        namespace: "ns-test",
        nowMs: NOW_MS,
        projectId: "project-1",
      }).failureReason
    ).toBe("balance-exhausted");
  });

  test("failed-quota is a quota-exceeded task naming the full storage quota", () => {
    const { task } = deployTaskDevMockTask("failed-quota", {
      namespace: "ns-test",
      nowMs: NOW_MS,
      projectId: "project-1",
    });
    expect(task.failureDetails?.reason).toBe("quota-exceeded");
    expect(task.failureDetails?.billingEvidence).toEqual({
      kind: "quota-full",
      label: "Storage",
      percentUsed: 100,
      type: "storage",
    });
    expect(task.error).toContain("exceeded quota");
  });
});
