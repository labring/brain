import assert from "node:assert/strict";
import { test } from "node:test";
import YAML from "yaml";
import type { DatabaseDeploymentChoice } from "@/features/deployment/database-deployer";
import type { ProjectExplorerProject } from "@/features/projects/explorer/project-explorer";
import {
  type DeploymentTargetPipelineAdapters,
  existingProjectDeploymentTarget,
  newProjectDeploymentTarget,
  runDeploymentTargetPipeline,
} from "./pipeline";

function testAdapters(overrides?: {
  createProject?: DeploymentTargetPipelineAdapters["createProject"];
  deleteProject?: DeploymentTargetPipelineAdapters["deleteProject"];
  createGithubDeployTask?: DeploymentTargetPipelineAdapters["createGithubDeployTask"];
  fetchProjectIdByName?: DeploymentTargetPipelineAdapters["fetchProjectIdByName"];
  generateChildResourceName?: DeploymentTargetPipelineAdapters["generateChildResourceName"];
  generateProjectName?: DeploymentTargetPipelineAdapters["generateProjectName"];
  onApplyBrainProductManifest?: (yaml: string) => void;
  onApplyTemplateDeployment?: (
    input: Parameters<
      DeploymentTargetPipelineAdapters["applyTemplateDeployment"]
    >[0]
  ) => void;
}): DeploymentTargetPipelineAdapters {
  return {
    applyBrainProductManifest: (yaml) => {
      overrides?.onApplyBrainProductManifest?.(yaml);
      return Promise.resolve();
    },
    applyTemplateDeployment: (input) => {
      overrides?.onApplyTemplateDeployment?.(input);
      return Promise.resolve({
        instanceName: input.instanceName,
        resources: [
          {
            name: input.instanceName,
            resourceType: "instance",
            uid: "instance-uid",
          },
        ],
      });
    },
    createProject:
      overrides?.createProject ??
      ((input) =>
        Promise.resolve({
          id: input.displayName.toLowerCase().replace(/\s+/g, "-"),
        })),
    deleteProject: overrides?.deleteProject ?? (() => Promise.resolve()),
    createGithubDeployTask:
      overrides?.createGithubDeployTask ??
      (() =>
        Promise.resolve({
          message: "Deploy task task-1 queued.",
          taskId: "task-1",
        })),
    fetchProjectIdByName:
      overrides?.fetchProjectIdByName ?? (() => Promise.resolve("project-uid")),
    generateChildResourceName:
      overrides?.generateChildResourceName ??
      ((resourceName, kind) => `${kind}-${resourceName}-child`),
    generateProjectName: overrides?.generateProjectName ?? (() => "project-a"),
  };
}

const databaseOptions = [
  {
    engine: "postgresql",
    id: "postgresql",
    label: "PostgreSQL",
  },
] satisfies DatabaseDeploymentChoice[];

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
const FAILED_TEMPLATE_APPLY_ERROR = /Failed to apply template YAML/;
const MISSING_PROJECT_ID_ERROR = /Could not resolve the current project/;

test("Deployment Target pipeline creates a new Project with Docker AP", async () => {
  let applied = "";
  const outcome = await runDeploymentTargetPipeline({
    adapters: testAdapters({
      onApplyBrainProductManifest: (yaml) => {
        applied = yaml;
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
      target: newProjectDeploymentTarget("API Project"),
    },
    routingDomain: "apps.example.com",
  });

  const docs = YAML.parseAllDocuments(applied).map((doc) => doc.toJS());
  assert.equal(docs.length, 1);
  assert.equal(docs[0].apiVersion, "brain.io/direct");
  assert.equal(docs[0].kind, "AP");
  assert.equal(docs[0].metadata.name, "ap-api-project-child");
  assert.equal(docs[0].spec.projectId, "api-project");
  assert.equal(outcome.kind, "docker");
  assert.equal(outcome.apName, "ap-api-project-child");
  assert.equal(outcome.projectId, "api-project");
  assert.equal(outcome.createdProject, true);
});

test("Deployment Target pipeline deploys a DB into an existing Project", async () => {
  let applied = "";
  const outcome = await runDeploymentTargetPipeline({
    adapters: testAdapters({
      onApplyBrainProductManifest: (yaml) => {
        applied = yaml;
      },
    }),
    credentialsReady: true,
    databaseOptions,
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

  const doc = YAML.parse(applied);
  assert.equal(doc.kind, "DB");
  assert.equal(doc.metadata.name, "db-existing-project-child");
  assert.equal(doc.spec.projectId, "existing-project");
  assert.equal(doc.spec.replicas, 2);
  assert.equal(outcome.kind, "database");
  assert.equal(outcome.dbName, "db-existing-project-child");
  assert.equal(outcome.projectId, "existing-uid");
  assert.equal(outcome.createdProject, false);
});

test("Deployment Target pipeline creates a new Project before GitHub task", async () => {
  const events: string[] = [];
  const outcome = await runDeploymentTargetPipeline({
    adapters: testAdapters({
      createGithubDeployTask: (input) => {
        events.push(`task:${input.projectName}:${input.projectId ?? ""}`);
        return Promise.resolve({
          message: "Deploy task task-9 queued.",
          taskId: "task-9",
        });
      },
      createProject: (input) => {
        events.push(`project:${input.displayName}:${input.namespace}`);
        return Promise.resolve({ id: "project-uid-9" });
      },
      onApplyBrainProductManifest: () => {
        events.push("apply");
      },
    }),
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
      target: newProjectDeploymentTarget("web"),
    },
  });

  assert.deepEqual(events, [
    "project:web:ns-admin",
    "task:project-uid-9:project-uid-9",
  ]);
  assert.equal(outcome.kind, "github");
  assert.equal(outcome.projectName, "project-uid-9");
  assert.equal(outcome.projectId, "project-uid-9");
  assert.equal(outcome.taskId, "task-9");
});

test("Deployment Target pipeline deploys a template into an existing Project", async () => {
  let applied:
    | Parameters<DeploymentTargetPipelineAdapters["applyTemplateDeployment"]>[0]
    | null = null;
  const outcome = await runDeploymentTargetPipeline({
    adapters: testAdapters({
      onApplyTemplateDeployment: (input) => {
        applied = input;
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

  assert.deepEqual(applied, {
    args: { storage: "10" },
    instanceName: "template-memos-child",
    namespace: "ns-admin",
    projectId: "existing-uid",
    projectName: "existing-project",
    templateName: "memos",
  });
  assert.equal(outcome.kind, "template");
  assert.equal(outcome.instanceName, "template-memos-child");
  assert.equal(outcome.projectId, "existing-uid");
  assert.equal(outcome.createdProject, false);
});

test("Deployment Target pipeline deletes a newly created Project when template deploy fails", async () => {
  const events: string[] = [];
  await assert.rejects(
    runDeploymentTargetPipeline({
      adapters: testAdapters({
        createProject: (input) => {
          events.push(`create:${input.displayName}:${input.namespace}`);
          return Promise.resolve({ id: "new-project-uid" });
        },
        deleteProject: (input) => {
          events.push(`delete:${input.id}:${input.namespace}`);
          return Promise.resolve();
        },
        onApplyTemplateDeployment: (input) => {
          events.push(`apply:${input.projectId}:${input.templateName}`);
          throw new Error("Failed to apply template YAML.");
        },
      }),
      credentialsReady: true,
      existingProjects,
      namespace: "ns-admin",
      request: {
        args: { init_password: "password123" },
        kind: "template",
        target: newProjectDeploymentTarget("dify"),
        templateName: "dify",
      },
    }),
    FAILED_TEMPLATE_APPLY_ERROR
  );

  assert.deepEqual(events, [
    "create:dify:ns-admin",
    "apply:new-project-uid:dify",
    "delete:new-project-uid:ns-admin",
  ]);
});

test("Deployment Target pipeline does not delete existing Projects when template deploy fails", async () => {
  const deleted: string[] = [];
  await assert.rejects(
    runDeploymentTargetPipeline({
      adapters: testAdapters({
        deleteProject: (input) => {
          deleted.push(input.id);
          return Promise.resolve();
        },
        onApplyTemplateDeployment: () => {
          throw new Error("Failed to apply template YAML.");
        },
      }),
      credentialsReady: true,
      existingProjects,
      namespace: "ns-admin",
      request: {
        kind: "template",
        target: existingProjectDeploymentTarget({
          projectName: "existing-project",
          projectId: "existing-uid",
        }),
        templateName: "dify",
      },
    }),
    FAILED_TEMPLATE_APPLY_ERROR
  );

  assert.deepEqual(deleted, []);
});

test("Deployment Target pipeline preserves the template error when cleanup fails", async () => {
  const events: string[] = [];
  await assert.rejects(
    runDeploymentTargetPipeline({
      adapters: testAdapters({
        createProject: () => Promise.resolve({ id: "new-project-uid" }),
        deleteProject: () => {
          events.push("cleanup");
          return Promise.reject(new Error("Cleanup failed."));
        },
        onApplyTemplateDeployment: () => {
          events.push("apply");
          throw new Error("Failed to apply template YAML.");
        },
      }),
      credentialsReady: true,
      existingProjects,
      namespace: "ns-admin",
      request: {
        kind: "template",
        target: newProjectDeploymentTarget("dify"),
        templateName: "dify",
      },
    }),
    FAILED_TEMPLATE_APPLY_ERROR
  );

  assert.deepEqual(events, ["apply", "cleanup"]);
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
