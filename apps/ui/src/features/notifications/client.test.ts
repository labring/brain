import { test } from "bun:test";
import assert from "node:assert/strict";

import { postNotificationReadReceipts, readReceiptBatches } from "./client";

const CREDENTIALS = { appToken: "t", kubeconfig: "k", namespace: "ns-a" };
const MARK_READ_FAILED_RE = /Mark-read request failed \(503\)/;

function ids(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `cr:name-${index}:1`);
}

test("readReceiptBatches splits ids at the route's limit and keeps order", () => {
  assert.deepEqual(readReceiptBatches([], 3), []);
  assert.deepEqual(readReceiptBatches(["a", "b", "c"], 3), [["a", "b", "c"]]);
  assert.deepEqual(readReceiptBatches(["a", "b", "c", "d"], 3), [
    ["a", "b", "c"],
    ["d"],
  ]);
  assert.deepEqual(
    readReceiptBatches(ids(401)).map((b) => b.length),
    [200, 200, 1]
  );
});

test("postNotificationReadReceipts sends one request per batch, none for no ids", async () => {
  const bodies: string[][] = [];
  const fetchImpl = ((_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { ids: string[] };
    bodies.push(body.ids);
    return Promise.resolve(
      new Response(JSON.stringify({ read: body.ids }), { status: 200 })
    );
  }) as typeof fetch;

  await postNotificationReadReceipts(CREDENTIALS, [], fetchImpl);
  assert.equal(bodies.length, 0);

  await postNotificationReadReceipts(CREDENTIALS, ids(450), fetchImpl);
  assert.deepEqual(
    bodies.map((b) => b.length),
    [200, 200, 50]
  );
  assert.deepEqual(bodies.flat(), ids(450));
});

test("postNotificationReadReceipts rejects on a failed batch", async () => {
  let calls = 0;
  const fetchImpl = ((_url: unknown, _init?: RequestInit) => {
    calls += 1;
    return Promise.resolve(
      new Response("", { status: calls === 2 ? 503 : 200 })
    );
  }) as typeof fetch;

  await assert.rejects(
    postNotificationReadReceipts(CREDENTIALS, ids(250), fetchImpl),
    MARK_READ_FAILED_RE
  );
  assert.equal(calls, 2);
});
