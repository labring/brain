import assert from "node:assert/strict";
import { test } from "node:test";

import {
  WORKSPACE_NAME_ISSUE_MESSAGES,
  workspaceNameIssue,
} from "./workspace-creation-core";

const EXISTING = ["private team", "Acme", "Sandbox"];

test("a trimmed, unique name within the cap has no issue", () => {
  assert.equal(workspaceNameIssue("  Robotics  ", EXISTING), null);
  assert.equal(workspaceNameIssue("x".repeat(32), EXISTING), null);
});

test("a blank name is required", () => {
  assert.equal(workspaceNameIssue("", EXISTING), "required");
  assert.equal(workspaceNameIssue("   ", EXISTING), "required");
});

test("a name over 32 characters after trimming is too long", () => {
  assert.equal(workspaceNameIssue(`${"x".repeat(33)}`, EXISTING), "too-long");
  assert.equal(workspaceNameIssue(`  ${"x".repeat(32)}  `, EXISTING), null);
});

test("a name matching a loaded Workspace case-insensitively is a duplicate", () => {
  assert.equal(workspaceNameIssue("acme", EXISTING), "duplicate");
  assert.equal(workspaceNameIssue(" ACME ", EXISTING), "duplicate");
  assert.equal(workspaceNameIssue("Acme Robotics", EXISTING), null);
});

test("every issue has a message for the field", () => {
  for (const issue of ["required", "too-long", "duplicate"] as const) {
    assert.ok(WORKSPACE_NAME_ISSUE_MESSAGES[issue].length > 0);
  }
  assert.ok(WORKSPACE_NAME_ISSUE_MESSAGES["too-long"].includes("32"));
});
