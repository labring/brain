import { mock } from "bun:test";
import assert from "node:assert/strict";
import { test } from "node:test";

mock.module("server-only", () => ({}));

const { createProjectContextTools, discoverProjectContextInputSchema } =
  await import("./tool");

test("registers discovery only for Project scope and binds verified scope outside model input", async () => {
  const workspaceTools = createProjectContextTools({
    assistantContext: { kind: "workspace" },
    kubeconfig: "verified-kubeconfig",
    kubernetesNamespace: "ns-a",
    workspaceActor: "workspace-actor-a",
  });
  assert.deepEqual(workspaceTools, {});

  assert.equal(
    discoverProjectContextInputSchema.safeParse({
      intention: "inspect the current Project",
      limit: 10,
      projectId: "forged-project",
    }).success,
    false
  );

  let received: unknown;
  const tools = createProjectContextTools(
    {
      assistantContext: { kind: "project", projectId: "project-a" },
      kubeconfig: "verified-kubeconfig",
      kubernetesNamespace: "ns-a",
      workspaceActor: "workspace-actor-a",
    },
    {
      buildProjectContextIndex: (input) => {
        received = input;
        return Promise.resolve({
          activeDeploymentTasks: { items: [], truncated: false },
          contents: { items: [], truncated: false },
          deploymentHistory: { items: [], truncated: false },
          project: {
            capabilities: [
              "discoverResources",
              "discoverDeployments",
              "discoverContents",
            ],
            displayName: "Project A",
            ref: { id: "project-a", kind: "Project", namespace: "ns-a" },
          },
          resources: { items: [], truncated: false },
          version: 1,
        });
      },
    }
  );

  const result = await tools.discoverProjectContext?.execute?.(
    { intention: "inspect the current Project", limit: 10 },
    { messages: [], toolCallId: "call-1" }
  );
  assert.equal((result as { ok?: boolean } | undefined)?.ok, true);
  assert.deepEqual(received, {
    kubeconfig: "verified-kubeconfig",
    limit: 10,
    namespace: "ns-a",
    projectId: "project-a",
    workspaceActor: "workspace-actor-a",
  });
});

test("does not disclose internal discovery failures", async () => {
  const tools = createProjectContextTools(
    {
      assistantContext: { kind: "project", projectId: "project-a" },
      kubeconfig: "verified-kubeconfig",
      kubernetesNamespace: "ns-a",
      workspaceActor: "workspace-actor-a",
    },
    {
      buildProjectContextIndex: () =>
        Promise.reject(new Error("sensitive internal detail")),
    }
  );

  const result = await tools.discoverProjectContext?.execute?.(
    { intention: "inspect the current Project" },
    { messages: [], toolCallId: "call-2" }
  );

  assert.deepEqual(result, {
    error: "Project context is unavailable.",
    ok: false,
  });
  assert.equal(
    JSON.stringify(result).includes("sensitive internal detail"),
    false
  );
});
