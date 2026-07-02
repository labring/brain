import assert from "node:assert/strict";
import { test } from "node:test";

import {
  RESOURCE_LOGS_DEFAULT_LIMIT,
  RESOURCE_LOGS_POLL_INTERVAL_MS,
  resourceLogsRefreshIntervalMs,
  resourceLogsTarget,
  resourceLogsTruncatedAt,
  resourceLogsWindow,
  resourceLogsWindowKey,
  workloadLogsToLogEntries,
} from "./logs-pane-data";

test("resource logs target rejects incomplete identity", () => {
  assert.equal(
    resourceLogsTarget({ kind: "ap", name: " ", namespace: "project-a" }),
    null
  );
  assert.deepEqual(
    resourceLogsTarget({ kind: "db", name: "pg", namespace: "project-a" }),
    { kind: "db", name: "pg", namespace: "project-a" }
  );
});

test("resource logs window derives live bounds from current time", () => {
  const now = new Date("2026-05-18T01:00:00.000Z");

  assert.deepEqual(resourceLogsWindow({ mode: "live", spanMs: 60_000 }, now), {
    end: now,
    start: new Date("2026-05-18T00:59:00.000Z"),
  });
});

test("resource logs window passes frozen bounds through", () => {
  const start = new Date("2026-05-18T00:00:00.000Z");
  const end = new Date("2026-05-18T00:30:00.000Z");

  assert.deepEqual(resourceLogsWindow({ end, mode: "frozen", start }), {
    end,
    start,
  });
});

test("window keys separate live spans from frozen bounds", () => {
  assert.equal(
    resourceLogsWindowKey({ mode: "live", spanMs: 60_000 }),
    "live-60000"
  );
  assert.equal(
    resourceLogsWindowKey({
      end: new Date("2026-05-18T00:30:00.000Z"),
      mode: "frozen",
      start: new Date("2026-05-18T00:00:00.000Z"),
    }),
    "2026-05-18T00:00:00.000Z-2026-05-18T00:30:00.000Z"
  );
});

test("only live windows poll", () => {
  assert.equal(
    resourceLogsRefreshIntervalMs({ mode: "live", spanMs: 60_000 }),
    RESOURCE_LOGS_POLL_INTERVAL_MS
  );
  assert.equal(
    resourceLogsRefreshIntervalMs({
      end: new Date("2026-05-18T00:30:00.000Z"),
      mode: "frozen",
      start: new Date("2026-05-18T00:00:00.000Z"),
    }),
    0
  );
});

test("truncation surfaces only when the fetch limit is hit", () => {
  const entry = {
    container: "api",
    message: "m",
    node: "",
    pod: "web",
    stream: "stdout",
    time: "2026-05-18T01:00:00.000Z",
  };

  assert.equal(resourceLogsTruncatedAt([entry]), undefined);
  assert.equal(
    resourceLogsTruncatedAt(
      Array.from({ length: RESOURCE_LOGS_DEFAULT_LIMIT }, () => entry)
    ),
    RESOURCE_LOGS_DEFAULT_LIMIT
  );
});

test("workload logs response normalizes VictoriaLogs fields", () => {
  const got = workloadLogsToLogEntries({
    "web-aaa/api": [
      {
        _msg: "older",
        _time: "2026-05-18T00:59:00.000Z",
        container: "api",
        pod: "web-aaa",
        stream: "stdout",
      },
      {
        _msg: "newer",
        _time: "2026-05-18T01:00:00.000Z",
        container: "api",
        pod: "web-aaa",
        stream: "stderr",
      },
    ],
  });

  assert.deepEqual(got, [
    {
      container: "api",
      message: "older",
      node: "",
      pod: "web-aaa",
      stream: "stdout",
      time: "2026-05-18T00:59:00.000Z",
    },
    {
      container: "api",
      message: "newer",
      node: "",
      pod: "web-aaa",
      stream: "stderr",
      time: "2026-05-18T01:00:00.000Z",
    },
  ]);
});

test("workload logs response skips empty null groups", () => {
  const got = workloadLogsToLogEntries({
    "postgresql/empty": null,
    "postgresql/live": [
      {
        _msg: "ready",
        _time: "2026-05-18T01:00:00.000Z",
        container: "postgresql",
      },
    ],
  });

  assert.deepEqual(got, [
    {
      container: "postgresql",
      message: "ready",
      node: "",
      pod: "",
      stream: "",
      time: "2026-05-18T01:00:00.000Z",
    },
  ]);
});
