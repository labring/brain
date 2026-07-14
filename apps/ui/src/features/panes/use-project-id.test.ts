import assert from "node:assert/strict";
import { test } from "node:test";

import { projectIdFromPathname } from "./use-project-id";

test("projectIdFromPathname decodes the id segment on a project route", () => {
  assert.equal(projectIdFromPathname("/project/brain-abc123"), "brain-abc123");
});

test("projectIdFromPathname decodes percent-encoded ids", () => {
  assert.equal(projectIdFromPathname("/project/a%20b"), "a b");
});

test("projectIdFromPathname reads only the first segment of nested routes", () => {
  assert.equal(
    projectIdFromPathname("/project/brain-abc/settings"),
    "brain-abc"
  );
});

test("projectIdFromPathname returns undefined off a specific project route", () => {
  assert.equal(projectIdFromPathname("/project"), undefined);
  assert.equal(projectIdFromPathname("/project/"), undefined);
  assert.equal(projectIdFromPathname("/"), undefined);
  assert.equal(projectIdFromPathname("/dashboard"), undefined);
});

test("projectIdFromPathname falls back to the raw segment on malformed encoding", () => {
  assert.equal(projectIdFromPathname("/project/%E0%A4%A"), "%E0%A4%A");
});
