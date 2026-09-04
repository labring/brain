import { mock } from "bun:test";
import assert from "node:assert/strict";
import { test } from "node:test";

mock.module("server-only", () => ({}));

const { buildProjectContextIndex, ProjectContextUnavailableError } =
  await import("./index");

test("discovers safe Project resources, deployments, and content references", async () => {
  const index = await buildProjectContextIndex(
    {
      kubeconfig: "verified-kubeconfig",
      namespace: "ns-a",
      projectId: "project-a",
      workspaceActor: "workspace-actor-a",
    },
    {
      listProjectResources: () =>
        Promise.resolve({
          aps: [
            {
              metadata: {
                annotations: { "brain.io/display-name": "Web API" },
                labels: { "brain.io/project-id": "project-a" },
                name: "api-7d9",
                namespace: "ns-a",
                uid: "uid-ap-1",
              },
              spec: { image: "private.example/api:sha" },
              status: { phase: "Running", readyReplicas: 1 },
            },
          ],
          dbs: [
            {
              metadata: {
                labels: { "brain.io/project-id": "project-a" },
                name: "postgres-5f3",
                namespace: "ns-a",
                uid: "uid-db-1",
              },
              spec: { engine: "postgresql" },
              status: {
                connectionStringPrivate: "postgres://admin:secret@db",
                phase: "Running",
              },
            },
          ],
        }),
      listTasks: ({ status }) =>
        Promise.resolve(
          status.includes("running")
            ? {
                nextCursor: null,
                tasks: [
                  {
                    artifactSummary: {},
                    canvasProjection: {},
                    completedAt: null,
                    createdAt: "2026-09-04T01:00:00.000Z",
                    id: "task-active",
                    namespace: "ns-a",
                    phase: "apply",
                    projectId: "project-a",
                    source: {
                      kind: "prompt",
                      text: "deploy with password=do-not-return",
                    },
                    status: "running",
                  },
                ],
              }
            : {
                nextCursor: null,
                tasks: [
                  {
                    artifactSummary: {
                      entrypointYaml: "kind: Secret\nstringData:\n  token: no",
                      resources: [
                        {
                          apiVersion: "brain.io/direct",
                          kind: "AP",
                          name: "api-7d9",
                          namespace: "ns-a",
                        },
                      ],
                    },
                    canvasProjection: {
                      resultMappings: [
                        {
                          actualRef: {
                            kind: "AP",
                            name: "api-7d9",
                            namespace: "ns-a",
                          },
                          slotId: "web",
                        },
                      ],
                    },
                    completedAt: "2026-09-03T02:00:00.000Z",
                    createdAt: "2026-09-03T01:00:00.000Z",
                    id: "task-template",
                    namespace: "ns-a",
                    phase: "completed",
                    projectId: "project-a",
                    source: {
                      args: { admin_password: "do-not-return" },
                      kind: "template",
                      templateName: "minecraft",
                    },
                    status: "completed",
                  },
                ],
              }
        ),
      readProject: () =>
        Promise.resolve({
          createdAt: "2026-09-01T00:00:00.000Z",
          description: "Game server",
          displayName: "Minecraft",
          id: "project-a",
          namespace: "ns-a",
          updatedAt: "2026-09-04T00:00:00.000Z",
        }),
    }
  );

  assert.deepEqual(index.project, {
    capabilities: [
      "discoverResources",
      "discoverDeployments",
      "discoverContents",
    ],
    description: "Game server",
    displayName: "Minecraft",
    ref: { id: "project-a", kind: "Project", namespace: "ns-a" },
  });
  assert.deepEqual(
    index.resources.items.map((item) => item.ref),
    [
      {
        kind: "AP",
        name: "api-7d9",
        namespace: "ns-a",
        observedUid: "uid-ap-1",
      },
      {
        kind: "DB",
        name: "postgres-5f3",
        namespace: "ns-a",
        observedUid: "uid-db-1",
      },
    ]
  );
  assert.equal(index.activeDeploymentTasks.items[0]?.ref.id, "task-active");
  assert.equal(index.deploymentHistory.items[0]?.ref.id, "task-template");
  assert.deepEqual(index.contents.items, [
    {
      capabilities: ["read"],
      ref: {
        kind: "ProjectContent",
        uri: "project-content://deployment-task/task-template/template-readme",
      },
      source: { taskId: "task-template", templateName: "minecraft" },
      title: "minecraft README",
      trust: "untrusted-content",
      type: "template-readme",
    },
  ]);

  const serialized = JSON.stringify(index);
  for (const secret of [
    "do-not-return",
    "postgres://",
    "stringData",
    "private.example",
  ]) {
    assert.equal(serialized.includes(secret), false);
  }
});

test("returns an empty discoverable index for an empty Project", async () => {
  const index = await buildProjectContextIndex(
    {
      kubeconfig: "verified-kubeconfig",
      namespace: "ns-a",
      projectId: "project-empty",
      workspaceActor: "workspace-actor-a",
    },
    {
      listProjectResources: () => Promise.resolve({ aps: [], dbs: [] }),
      listTasks: () => Promise.resolve({ nextCursor: null, tasks: [] }),
      readProject: () =>
        Promise.resolve({
          createdAt: "2026-09-01T00:00:00.000Z",
          description: "",
          displayName: "Empty",
          id: "project-empty",
          namespace: "ns-a",
          updatedAt: "2026-09-01T00:00:00.000Z",
        }),
    }
  );

  assert.deepEqual(index.resources, { items: [], truncated: false });
  assert.deepEqual(index.activeDeploymentTasks, {
    items: [],
    truncated: false,
  });
  assert.deepEqual(index.deploymentHistory, { items: [], truncated: false });
  assert.deepEqual(index.contents, { items: [], truncated: false });
  assert.equal("description" in index.project, false);
});

test("bounds large Project sections and reports undiscovered content", async () => {
  const resource = (name: string) => ({
    metadata: {
      labels: { "brain.io/project-id": "project-large" },
      name,
      namespace: "ns-a",
    },
    status: { phase: "Running" },
  });
  const index = await buildProjectContextIndex(
    {
      kubeconfig: "verified-kubeconfig",
      limit: 1,
      namespace: "ns-a",
      projectId: "project-large",
      workspaceActor: "workspace-actor-a",
    },
    {
      listProjectResources: () =>
        Promise.resolve({
          aps: [resource("api-a"), resource("api-b")],
          dbs: [],
        }),
      listTasks: ({ status }) =>
        Promise.resolve(
          status.includes("running")
            ? { nextCursor: null, tasks: [] }
            : {
                nextCursor: "next-history-page",
                tasks: [
                  {
                    artifactSummary: {},
                    canvasProjection: {},
                    completedAt: "2026-09-03T02:00:00.000Z",
                    createdAt: "2026-09-03T01:00:00.000Z",
                    id: "task-template-1",
                    namespace: "ns-a",
                    phase: "completed",
                    projectId: "project-large",
                    source: { kind: "template", templateName: "one" },
                    status: "completed",
                  },
                ],
              }
        ),
      readProject: () =>
        Promise.resolve({
          createdAt: "2026-09-01T00:00:00.000Z",
          description: "",
          displayName: "Large",
          id: "project-large",
          namespace: "ns-a",
          updatedAt: "2026-09-01T00:00:00.000Z",
        }),
    }
  );

  assert.equal(index.resources.items.length, 1);
  assert.equal(index.resources.truncated, true);
  assert.equal(index.deploymentHistory.nextCursor, "next-history-page");
  assert.equal(index.deploymentHistory.truncated, true);
  assert.equal(index.contents.items.length, 1);
  assert.equal(index.contents.truncated, true);
});

test("drops resources and tasks that cannot prove current Project ownership", async () => {
  const resource = (name: string, namespace?: string) => ({
    metadata: {
      labels: { "brain.io/project-id": "project-a" },
      name,
      ...(namespace === undefined ? {} : { namespace }),
    },
    status: { phase: "Running" },
  });
  const index = await buildProjectContextIndex(
    {
      kubeconfig: "verified-kubeconfig",
      namespace: "ns-a",
      projectId: "project-a",
      workspaceActor: "workspace-actor-a",
    },
    {
      listProjectResources: () =>
        Promise.resolve({
          aps: [
            resource("missing-namespace"),
            resource("foreign-namespace", "ns-b"),
            resource("owned", "ns-a"),
          ],
          dbs: [],
        }),
      listTasks: () =>
        Promise.resolve({
          nextCursor: null,
          tasks: [
            {
              artifactSummary: {},
              canvasProjection: {},
              completedAt: null,
              createdAt: "2026-09-04T01:00:00.000Z",
              id: "foreign-task",
              namespace: "ns-a",
              phase: "apply",
              projectId: "project-b",
              source: { kind: "prompt", text: "private request" },
              status: "running",
            },
          ],
        }),
      readProject: () =>
        Promise.resolve({
          createdAt: "2026-09-01T00:00:00.000Z",
          description: "",
          displayName: "Project A",
          id: "project-a",
          namespace: "ns-a",
          updatedAt: "2026-09-01T00:00:00.000Z",
        }),
    }
  );

  assert.deepEqual(
    index.resources.items.map((item) => item.ref.name),
    ["owned"]
  );
  assert.deepEqual(index.activeDeploymentTasks.items, []);
  assert.deepEqual(index.deploymentHistory.items, []);
  assert.equal(JSON.stringify(index).includes("private request"), false);
});

test("uses one non-disclosing failure for missing or mismatched Project access", async () => {
  const input = {
    kubeconfig: "verified-kubeconfig",
    namespace: "ns-a",
    projectId: "project-a",
    workspaceActor: "workspace-actor-a",
  };
  const baseDependencies = {
    listProjectResources: () => Promise.resolve({ aps: [], dbs: [] }),
    listTasks: () => Promise.resolve({ nextCursor: null, tasks: [] }),
  };

  for (const readProject of [
    () => Promise.resolve(null),
    () =>
      Promise.resolve({
        createdAt: "2026-09-01T00:00:00.000Z",
        description: "Foreign Project",
        displayName: "Foreign",
        id: "project-b",
        namespace: "ns-b",
        updatedAt: "2026-09-01T00:00:00.000Z",
      }),
  ]) {
    await assert.rejects(
      buildProjectContextIndex(input, { ...baseDependencies, readProject }),
      (error: unknown) =>
        error instanceof ProjectContextUnavailableError &&
        error.message === "Project context is unavailable."
    );
  }
});

test("fails closed before discovery when the verified Workspace Actor is unauthorized", async () => {
  let discoveryStarted = false;

  await assert.rejects(
    buildProjectContextIndex(
      {
        kubeconfig: "verified-kubeconfig",
        namespace: "ns-a",
        projectId: "project-a",
        workspaceActor: "unauthorized-actor",
      },
      {
        listProjectResources: () => {
          discoveryStarted = true;
          return Promise.resolve({ aps: [], dbs: [] });
        },
        listTasks: () => {
          discoveryStarted = true;
          return Promise.resolve({ nextCursor: null, tasks: [] });
        },
        readProject: ({ workspaceActor }) => {
          assert.equal(workspaceActor, "unauthorized-actor");
          return Promise.resolve(null);
        },
      }
    ),
    (error: unknown) =>
      error instanceof ProjectContextUnavailableError &&
      error.message === "Project context is unavailable."
  );

  assert.equal(discoveryStarted, false);
});

test("fails closed before persistence access when verified scope is incomplete", async () => {
  let persistenceStarted = false;

  await assert.rejects(
    buildProjectContextIndex(
      {
        kubeconfig: "verified-kubeconfig",
        namespace: "ns-a",
        projectId: "project-a",
        workspaceActor: " ",
      },
      {
        listProjectResources: () => Promise.resolve({ aps: [], dbs: [] }),
        listTasks: () => Promise.resolve({ nextCursor: null, tasks: [] }),
        readProject: () => {
          persistenceStarted = true;
          return Promise.resolve(null);
        },
      }
    ),
    (error: unknown) => error instanceof ProjectContextUnavailableError
  );

  assert.equal(persistenceStarted, false);
});
