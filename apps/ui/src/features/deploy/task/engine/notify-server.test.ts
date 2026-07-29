import { afterAll, beforeEach, expect, it, mock } from "bun:test";
import { createRequire } from "node:module";

import type { DeployTaskNotifyEvent } from "./notify";

const requireModule = createRequire(import.meta.url);
const originalDatabaseUrl = process.env.DATABASE_URL;

mock.module("server-only", () => ({}));

const realPg = requireModule("pg") as typeof import("pg");

type FakeHandler = (...args: unknown[]) => void;

const fakeBehavior = { failConnect: false, failListen: false };

class FakeClient {
  static instances: FakeClient[] = [];
  ended = false;
  queries: string[] = [];
  private readonly handlers = new Map<string, FakeHandler[]>();

  constructor(_config?: unknown) {
    FakeClient.instances.push(this);
  }

  emit(event: string, ...args: unknown[]): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(...args);
    }
  }

  on(event: string, handler: FakeHandler): this {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
    return this;
  }

  connect(): Promise<void> {
    if (fakeBehavior.failConnect) {
      return Promise.reject(new Error("connect refused"));
    }
    return Promise.resolve();
  }

  query(sql: string): Promise<{ rows: unknown[] }> {
    this.queries.push(sql);
    if (fakeBehavior.failListen) {
      return Promise.reject(new Error("listen refused"));
    }
    return Promise.resolve({ rows: [] });
  }

  end(): Promise<void> {
    this.ended = true;
    this.emit("end");
    return Promise.resolve();
  }
}

mock.module("pg", () => ({ ...realPg, Client: FakeClient }));

const { getDeployTaskNotifyTransport, resetDeployTaskNotifyTransportForTests } =
  requireModule("./notify-server") as typeof import("./notify-server");

async function waitFor(check: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error("condition not met in time");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function lastClient(): FakeClient {
  const client = FakeClient.instances.at(-1);
  if (client == null) {
    throw new Error("no FakeClient constructed");
  }
  return client;
}

beforeEach(async () => {
  FakeClient.instances.length = 0;
  fakeBehavior.failConnect = false;
  fakeBehavior.failListen = false;
  process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/test";
  await resetDeployTaskNotifyTransportForTests({ reconnectDelaysMs: [10, 10] });
});

afterAll(async () => {
  await resetDeployTaskNotifyTransportForTests();
  process.env.DATABASE_URL = originalDatabaseUrl;
  mock.module("pg", () => ({ ...realPg }));
});

it("rejects subscribe on initial LISTEN failure and reconnects in the background", async () => {
  fakeBehavior.failConnect = true;
  const transport = getDeployTaskNotifyTransport();
  const events: DeployTaskNotifyEvent[] = [];

  await expect(
    transport.subscribe((event) => events.push(event))
  ).rejects.toThrow("connect refused");
  expect(FakeClient.instances.length).toBe(1);

  fakeBehavior.failConnect = false;
  await waitFor(
    () =>
      FakeClient.instances.length >= 2 &&
      lastClient().queries.some((sql) => sql.includes("LISTEN"))
  );
  // The failed subscription was dropped, so the recovery reset reaches nobody.
  expect(events).toEqual([]);

  // The recovered connection serves new subscriptions immediately.
  const clientCount = FakeClient.instances.length;
  await transport.subscribe(() => undefined);
  expect(FakeClient.instances.length).toBe(clientCount);
});

it("keeps retrying with backoff while the connection stays down", async () => {
  fakeBehavior.failConnect = true;
  const transport = getDeployTaskNotifyTransport();

  await expect(transport.subscribe(() => undefined)).rejects.toThrow(
    "connect refused"
  );
  await waitFor(() => FakeClient.instances.length >= 3);
});

it("reconnects after an established connection drops and resets subscribers", async () => {
  const transport = getDeployTaskNotifyTransport();
  const events: DeployTaskNotifyEvent[] = [];
  await transport.subscribe((event) => events.push(event));
  expect(FakeClient.instances.length).toBe(1);

  FakeClient.instances[0]?.emit("end");
  await waitFor(() => events.some((event) => event.kind === "reset"));
  expect(FakeClient.instances.length).toBe(2);
  expect(lastClient().queries.some((sql) => sql.includes("LISTEN"))).toBe(true);
});

it("stops the reconnect loop when the transport is reset", async () => {
  fakeBehavior.failConnect = true;
  const transport = getDeployTaskNotifyTransport();

  await transport.subscribe(() => undefined).catch(() => undefined);
  await resetDeployTaskNotifyTransportForTests();
  const attempts = FakeClient.instances.length;
  await new Promise((resolve) => setTimeout(resolve, 60));
  expect(FakeClient.instances.length).toBe(attempts);
});

it("tears down the half-open client when LISTEN fails after connect", async () => {
  fakeBehavior.failListen = true;
  const transport = getDeployTaskNotifyTransport();

  await expect(transport.subscribe(() => undefined)).rejects.toThrow(
    "listen refused"
  );
  expect(FakeClient.instances[0]?.ended).toBe(true);
});
