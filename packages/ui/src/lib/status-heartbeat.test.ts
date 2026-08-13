import assert from "node:assert/strict";
import { test } from "node:test";

import { createStatusHeartbeat } from "./status-heartbeat";

function fakeRoot() {
  const attributes = new Map<string, string>();
  return {
    attributes,
    removeAttribute(name: string) {
      attributes.delete(name);
    },
    setAttribute(name: string, value: string) {
      attributes.set(name, value);
    },
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const FAST = { periodMs: 25 };

test("first acquire beats immediately and keeps beating", async () => {
  const root = fakeRoot();
  const heartbeat = createStatusHeartbeat(root, FAST);

  const release = heartbeat.acquire();
  const first = root.attributes.get("data-status-heartbeat");
  assert.ok(first === "a" || first === "b");

  await sleep(40);
  const second = root.attributes.get("data-status-heartbeat");
  assert.ok(second === "a" || second === "b");
  assert.notEqual(second, first);

  release();
});

test("releasing the last ref stops the beat and clears the attribute", async () => {
  const root = fakeRoot();
  const heartbeat = createStatusHeartbeat(root, FAST);

  const release = heartbeat.acquire();
  release();
  assert.equal(root.attributes.has("data-status-heartbeat"), false);

  await sleep(40);
  assert.equal(root.attributes.has("data-status-heartbeat"), false);
});

test("beat survives while any ref remains", async () => {
  const root = fakeRoot();
  const heartbeat = createStatusHeartbeat(root, FAST);

  const releaseA = heartbeat.acquire();
  const releaseB = heartbeat.acquire();
  releaseA();

  const before = root.attributes.get("data-status-heartbeat");
  await sleep(40);
  assert.notEqual(root.attributes.get("data-status-heartbeat"), before);

  releaseB();
});

test("setSuspended pauses beats and resuming restarts them immediately", async () => {
  const root = fakeRoot();
  const heartbeat = createStatusHeartbeat(root, FAST);

  const release = heartbeat.acquire();
  heartbeat.setSuspended(true);
  const paused = root.attributes.get("data-status-heartbeat");
  await sleep(40);
  assert.equal(root.attributes.get("data-status-heartbeat"), paused);

  heartbeat.setSuspended(false);
  assert.notEqual(root.attributes.get("data-status-heartbeat"), paused);

  release();
});

test("acquire while suspended defers the first beat to resume", async () => {
  const root = fakeRoot();
  const heartbeat = createStatusHeartbeat(root, FAST);

  heartbeat.setSuspended(true);
  const release = heartbeat.acquire();
  await sleep(40);
  assert.equal(root.attributes.has("data-status-heartbeat"), false);

  heartbeat.setSuspended(false);
  assert.equal(root.attributes.has("data-status-heartbeat"), true);

  release();
});

test("releasing the last ref while suspended clears the attribute", async () => {
  const root = fakeRoot();
  const heartbeat = createStatusHeartbeat(root, FAST);

  const release = heartbeat.acquire();
  heartbeat.setSuspended(true);
  release();
  assert.equal(root.attributes.has("data-status-heartbeat"), false);

  heartbeat.setSuspended(false);
  await sleep(40);
  assert.equal(root.attributes.has("data-status-heartbeat"), false);
});
