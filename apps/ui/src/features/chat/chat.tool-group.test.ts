import assert from "node:assert/strict";
import { test } from "node:test";

import { projectDeletionApprovalInput } from "./chat.tool-group";

test("Project deletion approval exposes the exact preview target and resources", () => {
  assert.deepEqual(
    projectDeletionApprovalInput({
      projectDisplayName: "Payments",
      projectId: "project-1",
      resourceSummary: { ap: ["api"], db: ["postgres"] },
    }),
    {
      displayName: "Payments",
      projectId: "project-1",
      resources: [
        ["ap", ["api"]],
        ["db", ["postgres"]],
      ],
    }
  );
});

test("Project deletion approval rejects malformed tool input", () => {
  assert.equal(projectDeletionApprovalInput({ projectId: "project-1" }), null);
  assert.equal(
    projectDeletionApprovalInput({
      projectDisplayName: "Payments",
      projectId: "project-1",
      resourceSummary: { ap: [1] },
    }),
    null
  );
});
