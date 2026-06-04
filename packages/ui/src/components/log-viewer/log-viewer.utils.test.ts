import assert from "node:assert/strict";
import { test } from "node:test";

import { formatLogMessage } from "./log-viewer.utils";

test("format log message removes duplicate leading timestamp before level", () => {
  assert.equal(
    formatLogMessage("2026-06-04 09:04:49,123 INFO: ready"),
    "INFO: ready"
  );
});

test("format log message keeps non-level messages unchanged", () => {
  assert.equal(
    formatLogMessage("2026-06-04 09:04:49,123 LOG: stats"),
    "2026-06-04 09:04:49,123 LOG: stats"
  );
});
