import assert from "node:assert/strict";
import { test } from "node:test";

import {
  lastViewedProjectStorageKey,
  normalizeLastViewedProjectId,
} from "./project-navigation-memory";

test("last-viewed project IDs normalize to a non-empty string", () => {
  assert.equal(normalizeLastViewedProjectId(" project-a "), "project-a");
  assert.equal(normalizeLastViewedProjectId(" "), undefined);
  assert.equal(normalizeLastViewedProjectId(123), undefined);
});

test("last-viewed project storage keys are scoped by namespace", () => {
  assert.equal(
    lastViewedProjectStorageKey("team alpha"),
    "sealai:last-viewed-project:team%20alpha"
  );
});
