import assert from "node:assert/strict";
import { test } from "node:test";

import {
  devboxApprovalInput,
  projectDeletionApprovalInput,
} from "./chat.tool-group";

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

test("Devbox approval exposes the exact bash command", () => {
  assert.deepEqual(
    devboxApprovalInput("tool-bash", {
      command: "kubectl rollout restart deploy/api",
      intention: "restart the selected API deployment",
    }),
    {
      command: "kubectl rollout restart deploy/api",
      intention: "restart the selected API deployment",
      kind: "bash",
    }
  );
});

test("Devbox approval exposes the exact file target and content", () => {
  assert.deepEqual(
    devboxApprovalInput("tool-writeFile", {
      content: "server-port=25565\n",
      intention: "prepare the reviewed server configuration",
      path: "/tmp/server.properties",
    }),
    {
      content: "server-port=25565\n",
      intention: "prepare the reviewed server configuration",
      kind: "write",
      path: "/tmp/server.properties",
    }
  );
});

test("Devbox approval rejects malformed or unrelated inputs", () => {
  assert.equal(devboxApprovalInput("tool-bash", {}), null);
  assert.equal(
    devboxApprovalInput("tool-writeProductResource", {
      command: "true",
    }),
    null
  );
});
