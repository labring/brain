import assert from "node:assert/strict";
import { test } from "node:test";

import { projectHistoryErrorEmptyState } from "./use-projects-explorer";

test("project history empty state separates missing credentials from database failures", () => {
  assert.deepEqual(
    projectHistoryErrorEmptyState(
      new Error('API 401: {"error":"Authentication is required."}')
    ),
    {
      description:
        "Project history is waiting for workspace credentials. Open Brain inside Sealos Desktop or configure NEXT_PUBLIC_DEV_ENCODED_KUBECONFIG for local development.",
      title: "Workspace credentials unavailable",
    }
  );

  assert.deepEqual(projectHistoryErrorEmptyState(new Error("boom")), {
    description:
      "Project history is temporarily unavailable because the app database cannot be reached. Check DATABASE_URL and database status, then refresh.",
    title: "System configuration unavailable",
  });
});
