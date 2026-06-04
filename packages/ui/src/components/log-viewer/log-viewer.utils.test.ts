import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatLogMessage,
  getLogLevel,
  parseLeadingLogLevel,
} from "./log-viewer.utils";

test("format log message removes duplicate leading timestamp before level", () => {
  assert.equal(
    formatLogMessage("2026-06-04 09:04:49,123 INFO: ready"),
    "INFO: ready"
  );
});

test("format log message removes duplicate leading timestamp before Postgres LOG level", () => {
  assert.equal(
    formatLogMessage("2026-06-04 09:04:49,123 LOG: stats"),
    "LOG: stats"
  );
});

test("log level normalizes common aliases", () => {
  assert.equal(getLogLevel("WARNING: disk pressure"), "WARN");
  assert.equal(getLogLevel("NOTICE: checkpoint complete"), "INFO");
  assert.equal(getLogLevel("LOG: stats"), "INFO");
  assert.equal(getLogLevel("DEBUG3: planner detail"), "DEBUG");
  assert.equal(getLogLevel("PANIC: database system is shut down"), "FATAL");
});

test("leading log level exposes fixed-slot prefix boundary", () => {
  const got = parseLeadingLogLevel("INFO: no action");

  assert.deepEqual(got, {
    endIndex: 6,
    level: "INFO",
    token: "INFO",
  });
});

test("log level can be read from structured message fields", () => {
  assert.equal(getLogLevel('{"level":"error","message":"failed"}'), "ERROR");
  assert.equal(getLogLevel("component ready severity=warning"), "WARN");
});
