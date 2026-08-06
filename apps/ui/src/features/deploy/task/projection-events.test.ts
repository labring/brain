import { afterAll, beforeEach, expect, it, mock } from "bun:test";
import { createRequire } from "node:module";

import type { DeployTaskNotifyListener } from "./engine/notify";
import type {
  DeploymentTaskProjection,
  DeploymentTaskProjectionStreamEvent,
} from "./projection";

const requireModule = createRequire(import.meta.url);

mock.module("server-only", () => ({}));

const realEngineServer = requireModule(
  "./engine/server"
) as typeof import("./engine/server");
const realService = requireModule("./service") as typeof import("./service");

let notifyListener: DeployTaskNotifyListener | null = null;
let subscribeShouldFail: Error | null = null;

interface DeferredRead {
  resolve: (row: unknown) => void;
  taskId: string;
}
const issuedReads: DeferredRead[] = [];

interface DeferredListRead {
  reject: (error: Error) => void;
  resolve: (projections: DeploymentTaskProjection[]) => void;
}
const issuedListReads: DeferredListRead[] = [];

mock.module("./engine/server", () => ({
  getDeployTaskEngineContext: () => ({
    notify: {
      publish: () => Promise.resolve(),
      subscribe: (listener: DeployTaskNotifyListener) => {
        if (subscribeShouldFail != null) {
          return Promise.reject(subscribeShouldFail);
        }
        notifyListener = listener;
        return Promise.resolve(() => undefined);
      },
    },
  }),
}));

mock.module("./service", () => ({
  getDeployTaskById: (taskId: string) =>
    new Promise((resolve) => {
      issuedReads.push({ resolve, taskId });
    }),
}));

const { subscribeDeploymentTaskProjectionEvents } = (await import(
  "./projection-events"
)) as typeof import("./projection-events");

afterAll(() => {
  mock.module("./engine/server", () => ({ ...realEngineServer }));
  mock.module("./service", () => ({ ...realService }));
});

beforeEach(() => {
  notifyListener = null;
  subscribeShouldFail = null;
  issuedReads.length = 0;
  issuedListReads.length = 0;
});

function taskRow(overrides: Record<string, unknown> = {}) {
  return {
    artifactSummary: {},
    cancelRequestedAt: null,
    canvasProjection: {},
    completedAt: null,
    id: "task-1",
    namespace: "ns-test",
    phase: "queued",
    projectId: "project-1",
    retriedFromTaskId: null,
    runner: { kind: "direct" },
    source: { kind: "docker", settings: { image: "nginx:latest" } },
    status: "queued",
    updatedAt: "2026-07-27T10:00:00.000Z",
    ...overrides,
  };
}

function notifyChange(taskId: string) {
  notifyListener?.({
    kind: "change",
    namespace: "ns-test",
    projectId: "project-1",
    taskId,
  });
}

function drain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function subscribeCollectingEvents() {
  const events: DeploymentTaskProjectionStreamEvent[] = [];
  const subscription = subscribeDeploymentTaskProjectionEvents({
    listProjections: () => Promise.resolve([]),
    listener: (event) => events.push(event),
    namespace: "ns-test",
    projectId: "project-1",
  });
  return { events, subscription };
}

function subscribeWithDeferredSnapshots() {
  const events: DeploymentTaskProjectionStreamEvent[] = [];
  const subscription = subscribeDeploymentTaskProjectionEvents({
    listProjections: () =>
      new Promise<DeploymentTaskProjection[]>((resolve, reject) => {
        issuedListReads.push({ reject, resolve });
      }),
    listener: (event) => events.push(event),
    namespace: "ns-test",
    projectId: "project-1",
  });
  return { events, subscription };
}

function eventLabel(event: DeploymentTaskProjectionStreamEvent): string {
  return event.type === "upsert" ? `upsert:${event.projection.id}` : event.type;
}

it("serializes per-task re-reads so the newest state is delivered last", async () => {
  const { events, subscription } = subscribeCollectingEvents();
  await subscription.ready;

  // A burst of notifications for one task: only one read may be in flight,
  // the rest collapse into a single trailing re-read.
  notifyChange("task-1");
  notifyChange("task-1");
  notifyChange("task-1");
  expect(issuedReads.length).toBe(1);

  // The row moved on while the first read was in flight; the first read
  // returns the older state, the trailing read returns the newer one.
  issuedReads[0]?.resolve(
    taskRow({ status: "running", updatedAt: "2026-07-27T10:00:01.000Z" })
  );
  await drain();
  expect(issuedReads.length).toBe(2);
  issuedReads[1]?.resolve(
    taskRow({ status: "applying", updatedAt: "2026-07-27T10:00:02.000Z" })
  );
  await drain();

  expect(issuedReads.length).toBe(2);
  const upserts = events.filter(
    (
      event
    ): event is Extract<
      DeploymentTaskProjectionStreamEvent,
      { type: "upsert" }
    > => event.type === "upsert"
  );
  expect(upserts.map((event) => event.projection.status)).toEqual([
    "running",
    "applying",
  ]);
  subscription.unsubscribe();
});

it("independent tasks re-read concurrently", async () => {
  const { events, subscription } = subscribeCollectingEvents();
  await subscription.ready;

  notifyChange("task-1");
  notifyChange("task-2");
  expect(issuedReads.map((read) => read.taskId)).toEqual(["task-1", "task-2"]);

  issuedReads[1]?.resolve(taskRow({ id: "task-2", status: "applying" }));
  issuedReads[0]?.resolve(taskRow({ status: "running" }));
  await drain();

  expect(
    events.map((event) =>
      event.type === "upsert" ? event.projection.id : event.type
    )
  ).toEqual(["task-2", "task-1"]);
  subscription.unsubscribe();
});

it("rejects ready when the notify subscribe fails", async () => {
  subscribeShouldFail = new Error("LISTEN refused");
  const { subscription } = subscribeCollectingEvents();

  await expect(subscription.ready).rejects.toThrow("LISTEN refused");
  subscription.unsubscribe();
});

it("re-emits a full snapshot when the transport resets", async () => {
  const { events, subscription } = subscribeCollectingEvents();
  await subscription.ready;

  notifyListener?.({ kind: "reset" });
  await drain();

  expect(events).toEqual([{ projections: [], type: "snapshot" }]);
  subscription.unsubscribe();
});

it("holds change deliveries back until the reset snapshot is delivered", async () => {
  const { events, subscription } = subscribeWithDeferredSnapshots();
  await subscription.ready;

  notifyListener?.({ kind: "reset" });
  expect(issuedListReads.length).toBe(1);

  // A change re-read completes while the snapshot read is still in flight.
  // Its upsert must wait: the snapshot read may predate the row, and a
  // snapshot without it would erase the task from the listener's set.
  notifyChange("task-9");
  issuedReads[0]?.resolve(taskRow({ id: "task-9", status: "running" }));
  await drain();
  expect(events).toEqual([]);

  issuedListReads[0]?.resolve([]);
  await drain();
  expect(events.map(eventLabel)).toEqual(["snapshot", "upsert:task-9"]);
  subscription.unsubscribe();
});

it("keeps only the newest snapshot when resets overlap", async () => {
  const { events, subscription } = subscribeWithDeferredSnapshots();
  await subscription.ready;

  notifyListener?.({ kind: "reset" });
  notifyListener?.({ kind: "reset" });
  expect(issuedListReads.length).toBe(2);

  // The older read resolving may carry pre-gap state; only the read owned
  // by the newest reset may emit.
  issuedListReads[0]?.resolve([]);
  await drain();
  expect(events).toEqual([]);

  issuedListReads[1]?.resolve([]);
  await drain();
  expect(events).toEqual([{ projections: [], type: "snapshot" }]);
  subscription.unsubscribe();
});

it("flushes held deliveries when the reset snapshot read fails", async () => {
  const { events, subscription } = subscribeWithDeferredSnapshots();
  await subscription.ready;

  notifyListener?.({ kind: "reset" });
  notifyChange("task-1");
  issuedReads[0]?.resolve(taskRow({ status: "running" }));
  await drain();
  expect(events).toEqual([]);

  issuedListReads[0]?.reject(new Error("snapshot read failed"));
  await drain();
  expect(events.map(eventLabel)).toEqual(["upsert:task-1"]);
  subscription.unsubscribe();
});
