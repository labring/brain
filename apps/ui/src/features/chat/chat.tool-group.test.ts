import assert from "node:assert/strict";
import { test } from "node:test";

import { projectDeletionApprovalInput } from "./chat.tool-group";

test("Project deletion approval exposes the exact preview target", () => {
  assert.deepEqual(
    projectDeletionApprovalInput({
      projectDisplayName: "Payments",
      projectId: "project-1",
      resourceSummary: { ap: ["api"], db: ["postgres"] },
    }),
    { projectId: "project-1" }
  );
});

test("Project deletion approval rejects malformed tool input", () => {
  assert.equal(projectDeletionApprovalInput({}), null);
  assert.equal(projectDeletionApprovalInput({ projectId: "" }), null);
});
