import assert from "node:assert/strict";
import { test } from "node:test";

import {
  resourceLogsTarget,
  resourceLogsWindow,
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

test("resource logs window derives quick range from current time", () => {
  const now = new Date("2026-05-18T01:00:00.000Z");

  assert.deepEqual(resourceLogsWindow({ mode: "quick", ms: 60_000 }, now), {
    end: now,
    start: new Date("2026-05-18T00:59:00.000Z"),
  });
});

test("workload logs response normalizes VictoriaLogs fields and sorts newest first", () => {
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
      message: "newer",
      node: "",
      pod: "web-aaa",
      stream: "stderr",
      time: "2026-05-18T01:00:00.000Z",
    },
    {
      container: "api",
      message: "older",
      node: "",
      pod: "web-aaa",
      stream: "stdout",
      time: "2026-05-18T00:59:00.000Z",
    },
  ]);
});
