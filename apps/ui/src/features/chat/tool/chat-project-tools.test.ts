import { mock } from "bun:test";
import assert from "node:assert/strict";
import { test } from "node:test";

mock.module("server-only", () => ({}));

const { createChatProjectTools, deleteProjectInputSchema } = await import(
  "./chat-project-tools"
);

test("Project delete tool requires AI SDK approval", () => {
  const tools = createChatProjectTools({
    chatId: "chat-1",
    kubeconfig: "kubeconfig",
    kubernetesNamespace: "ns-a",
    workspaceUserUid: "user-1",
  });

  assert.equal(Reflect.get(tools.deleteProject, "needsApproval"), true);
  assert.ok("listProjects" in tools);
  assert.ok("getProject" in tools);
  assert.ok("previewProjectDeletion" in tools);
});

test("Project deletion input uses the opaque preview and Project IDs", () => {
  assert.equal(
    deleteProjectInputSchema.safeParse({
      intention: "delete the selected Project after review",
      previewId: "preview-1",
      projectId: "project-1",
    }).success,
    true
  );
  assert.equal(
    deleteProjectInputSchema.safeParse({
      intention: "delete the selected Project after review",
      previewId: "preview-1",
      projectId: "project-1",
    }).success,
    true
  );
  assert.equal(
    deleteProjectInputSchema.safeParse({
      intention: "delete the selected Project after review",
      projectId: "project-1",
    }).success,
    false
  );
});
