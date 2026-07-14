import assert from "node:assert/strict";
import { test } from "node:test";
import type { ProjectExplorerProject } from "@/features/projects/explorer/project-explorer";
import {
  type DeploymentTargetPipelineAdapters,
  type DeploymentTaskCreateInput,
  type DeploymentTaskCreateResult,
  existingProjectDeploymentTarget,
  newProjectDeploymentTarget,
  runDeploymentTargetPipeline,
} from "./pipeline";

function testAdapters(overrides?: {
  createDeploymentTaskResult?: DeploymentTaskCreateResult;
  onCreateDeploymentTask?: (input: DeploymentTaskCreateInput) => void;
}): DeploymentTargetPipelineAdapters {
  return {
    createDeploymentTask: (input) => {
      overrides?.onCreateDeploymentTask?.(input);
      return Promise.resolve(
        overrides?.createDeploymentTaskResult ?? {
          message: "Deployment task task-1 queued.",
          projectId:
            input.target.kind === "existingProject" ? null : "project-uid",
          projectName:
            input.target.kind === "existingProject"
              ? (input.target.projectName ?? input.target.projectId)
              : "project-uid",
          taskId: "task-1",
        }
      );
    },
  };
}

const existingProjects = [
  {
    createdAt: "",
    id: "other-uid",
    name: "Existing",
    resourceName: "existing",
  },
] satisfies ProjectExplorerProject[];

const DUPLICATE_PROJECT_NAME_ERROR =
  /A project named "existing" already exists/;
const MISSING_PROJECT_ID_ERROR = /Could not resolve the current project/;
const MISSING_CREATED_PROJECT_ID_ERROR =
  /Could not resolve the created project/;

test("Deployment Target pipeline creates a Docker Deployment Task for a new Project", async () => {
  let created: DeploymentTaskCreateInput | null = null;
  const outcome = await runDeploymentTargetPipeline({
    adapters: testAdapters({
      onCreateDeploymentTask: (input) => {
        created = input;
      },
    }),
    credentialsReady: true,
    existingProjects,
    namespace: "ns-admin",
    request: {
      kind: "docker",
      settings: {
        appListeningPort: 8080,
        env: [],
        image: "ghcr.io/acme/api:1.2",
      },
      target: newProjectDeploymentTarget(
        "API Project",
        "Handles order traffic."
      ),
    },
  });

  assert.deepEqual(created, {
    namespace: "ns-admin",
    runner: { kind: "direct" },
    source: {
      kind: "docker",
      settings: {
        appListeningPort: 8080,
        env: [],
        image: "ghcr.io/acme/api:1.2",
      },
    },
    target: {
      description: "Handles order traffic.",
      displayName: "API Project",
      kind: "newProject",
    },
  });
  assert.equal(outcome.kind, "docker");
  assert.equal(outcome.createdProject, true);
  assert.equal(outcome.projectId, "project-uid");
  assert.equal(outcome.projectName, "project-uid");
  assert.equal(outcome.sourceLabel, "ghcr.io/acme/api:1.2");
  assert.equal(outcome.taskId, "task-1");
});

test("Deployment Target pipeline creates a database Deployment Task for an existing Project", async () => {
  let created: DeploymentTaskCreateInput | null = null;
  const outcome = await runDeploymentTargetPipeline({
    adapters: testAdapters({
      onCreateDeploymentTask: (input) => {
        created = input;
      },
    }),
    credentialsReady: true,
    existingProjects,
    namespace: "ns-admin",
    request: {
      kind: "database",
      settings: {
        databaseId: "postgresql",
        instancePreset: "xs",
        replicas: 2,
      },
      target: existingProjectDeploymentTarget({
        projectName: "existing-project",
        projectId: "existing-uid",
      }),
    },
  });

  assert.deepEqual(created, {
    namespace: "ns-admin",
    runner: { kind: "direct" },
    source: {
      kind: "database",
      settings: {
        databaseId: "postgresql",
        instancePreset: "xs",
        replicas: 2,
      },
    },
    target: {
      kind: "existingProject",
      projectId: "existing-uid",
      projectName: "existing-project",
    },
  });
  assert.equal(outcome.kind, "database");
  assert.equal(outcome.createdProject, false);
  assert.equal(outcome.projectId, "existing-uid");
  assert.equal(outcome.projectName, "existing-project");
  assert.equal(outcome.sourceLabel, "database");
});

test("Deployment Target pipeline creates a GitHub AI Deployment Task", async () => {
  let created: DeploymentTaskCreateInput | null = null;
  const outcome = await runDeploymentTargetPipeline({
    adapters: testAdapters({
      onCreateDeploymentTask: (input) => {
        created = input;
      },
    }),
    credentialsReady: true,
    existingProjects,
    actorUserId: "admin",
    githubConnectionId: "github-connection-1",
    namespace: "ns-admin",
    request: {
      kind: "github",
      repository: {
        fullName: "acme/web",
        id: "42",
        name: "web",
        url: "https://github.com/acme/web",
      },
      target: newProjectDeploymentTarget("web"),
    },
  });

  assert.deepEqual(created, {
    actorUserId: "admin",
    githubConnectionId: "github-connection-1",
    namespace: "ns-admin",
    runner: {
      kind: "ai",
      runtimeProvider: "devbox",
      skill: "sealos-deploy",
    },
    source: {
      kind: "github",
      repo: {
        fullName: "acme/web",
        id: "42",
        name: "web",
        url: "https://github.com/acme/web",
      },
    },
    target: {
      displayName: "web",
      kind: "newProject",
    },
  });
  assert.equal(outcome.kind, "github");
  assert.equal(outcome.sourceLabel, "acme/web");
});

test("Deployment Target pipeline creates a template Deployment Task", async () => {
  let created: DeploymentTaskCreateInput | null = null;
  const outcome = await runDeploymentTargetPipeline({
    adapters: testAdapters({
      onCreateDeploymentTask: (input) => {
        created = input;
      },
    }),
    credentialsReady: true,
    existingProjects,
    namespace: "ns-admin",
    request: {
      args: { storage: "10" },
      kind: "template",
      target: existingProjectDeploymentTarget({
        projectName: "existing-project",
        projectId: "existing-uid",
      }),
      templateName: "memos",
    },
  });

  assert.deepEqual(created, {
    namespace: "ns-admin",
    runner: { kind: "template" },
    source: {
      args: { storage: "10" },
      kind: "template",
      templateName: "memos",
    },
    target: {
      kind: "existingProject",
      projectId: "existing-uid",
      projectName: "existing-project",
    },
  });
  assert.equal(outcome.kind, "template");
  assert.equal(outcome.sourceLabel, "memos");
});

test("Deployment Target pipeline rejects template deploys without a Project id", async () => {
  await assert.rejects(
    runDeploymentTargetPipeline({
      adapters: testAdapters(),
      credentialsReady: true,
      existingProjects,
      namespace: "ns-admin",
      request: {
        kind: "template",
        target: existingProjectDeploymentTarget({
          projectName: "existing-project",
          projectId: "",
        }),
        templateName: "memos",
      },
    }),
    MISSING_PROJECT_ID_ERROR
  );
});

test("Deployment Target pipeline rejects new Project deploys without a resolved Project id", async () => {
  await assert.rejects(
    runDeploymentTargetPipeline({
      adapters: testAdapters({
        createDeploymentTaskResult: {
          message: "Deployment task task-1 queued.",
          projectId: null,
          projectName: null,
          taskId: "task-1",
        },
      }),
      credentialsReady: true,
      existingProjects,
      namespace: "ns-admin",
      request: {
        kind: "docker",
        settings: {
          appListeningPort: 8080,
          env: [],
          image: "ghcr.io/acme/api:1.2",
        },
        target: newProjectDeploymentTarget("web"),
      },
    }),
    MISSING_CREATED_PROJECT_ID_ERROR
  );
});

test("Deployment Target pipeline rejects duplicate new Project display names", async () => {
  await assert.rejects(
    runDeploymentTargetPipeline({
      adapters: testAdapters(),
      credentialsReady: true,
      existingProjects,
      namespace: "ns-admin",
      request: {
        kind: "github",
        repository: {
          fullName: "acme/web",
          id: "42",
          name: "web",
          url: "https://github.com/acme/web",
        },
        target: newProjectDeploymentTarget("existing"),
      },
    }),
    DUPLICATE_PROJECT_NAME_ERROR
  );
});
