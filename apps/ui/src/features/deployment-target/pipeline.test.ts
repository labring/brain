import assert from "node:assert/strict";
import { test } from "node:test";
import type { DatabaseDeploymentChoice } from "@workspace/ui/components/database-deployer";
import type { ProjectExplorerProject } from "@workspace/ui/components/project-explorer/project-explorer";
import YAML from "yaml";
import {
  type DeploymentTargetPipelineAdapters,
  existingProjectDeploymentTarget,
  newProjectDeploymentTarget,
  runDeploymentTargetPipeline,
} from "./pipeline";

function testAdapters(overrides?: {
  createGithubDeployTask?: DeploymentTargetPipelineAdapters["createGithubDeployTask"];
  fetchProjectUidByName?: DeploymentTargetPipelineAdapters["fetchProjectUidByName"];
  generateChildResourceName?: DeploymentTargetPipelineAdapters["generateChildResourceName"];
  generateProjectName?: DeploymentTargetPipelineAdapters["generateProjectName"];
  onApplyYaml?: (yaml: string) => void;
}): DeploymentTargetPipelineAdapters {
  return {
    applyYaml: (yaml) => {
      overrides?.onApplyYaml?.(yaml);
      return Promise.resolve();
    },
    createGithubDeployTask:
      overrides?.createGithubDeployTask ??
      (() =>
        Promise.resolve({
          message: "Deploy task task-1 queued.",
          taskId: "task-1",
        })),
    fetchProjectUidByName:
      overrides?.fetchProjectUidByName ??
      (() => Promise.resolve("project-uid")),
    generateChildResourceName:
      overrides?.generateChildResourceName ??
      ((projectName) => `${projectName}-child`),
    generateProjectName: overrides?.generateProjectName ?? (() => "project-a"),
  };
}

const projectCompositionRows = [
  {
    description: "",
    kind: "Project",
    metadata: { compositionName: "project-instance-go-templating" },
    name: "Project",
    template: `
apiVersion: example.crossplane.io/v1
kind: Project
metadata:
  name: {{ name }}
  namespace: {{ namespace }}
spec: {}
`,
  },
];

const apCompositionRows = [
  {
    description: "",
    kind: "AP",
    metadata: { compositionName: "aps-deployment-ingress-go-templating" },
    name: "AP",
    template: `
apiVersion: example.crossplane.io/v1
kind: AP
metadata:
  name: {{ name }}
  namespace: {{ namespace }}
spec: {}
`,
  },
];

const databaseOptions = [
  {
    engine: "postgresql",
    id: "dbs-postgresql-kubeblocks",
    label: "PostgreSQL",
    template: `
apiVersion: example.crossplane.io/v1
kind: DB
metadata:
  name: {{ name }}
  namespace: {{ namespace }}
spec: {}
`,
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

test("Deployment Target pipeline creates a new Project with Docker AP", async () => {
  let applied = "";
  const outcome = await runDeploymentTargetPipeline({
    adapters: testAdapters({
      onApplyYaml: (yaml) => {
        applied = yaml;
      },
    }),
    apCompositionRows,
    credentialsReady: true,
    existingProjects,
    namespace: "ns-admin",
    projectCompositionRows,
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
  assert.equal(docs.length, 2);
  assert.equal(docs[0].kind, "Project");
  assert.equal(docs[0].metadata.name, "project-a");
  assert.equal(docs[0].metadata.annotations.displayName, "API Project");
  assert.equal(docs[1].kind, "AP");
  assert.equal(docs[1].metadata.name, "project-a-child");
  assert.equal(docs[1].spec.projectName, "project-a");
  assert.equal(outcome.kind, "docker");
  assert.equal(outcome.apName, "project-a-child");
  assert.equal(outcome.projectUid, "project-uid");
  assert.equal(outcome.createdProject, true);
});

test("Deployment Target pipeline deploys a DB into an existing Project", async () => {
  let applied = "";
  const outcome = await runDeploymentTargetPipeline({
    adapters: testAdapters({
      onApplyYaml: (yaml) => {
        applied = yaml;
      },
    }),
    credentialsReady: true,
    databaseOptions,
    namespace: "ns-admin",
    request: {
      kind: "database",
      settings: {
        databaseId: "dbs-postgresql-kubeblocks",
        instancePreset: "xs",
        replicas: 2,
      },
      target: existingProjectDeploymentTarget({
        projectName: "existing-project",
        projectUid: "existing-uid",
      }),
    },
  });

  const doc = YAML.parse(applied);
  assert.equal(doc.kind, "DB");
  assert.equal(doc.metadata.name, "existing-project-child");
  assert.equal(doc.spec.projectName, "existing-project");
  assert.equal(doc.spec.replicas, 2);
  assert.equal(outcome.kind, "database");
  assert.equal(outcome.dbName, "existing-project-child");
  assert.equal(outcome.projectUid, "existing-uid");
  assert.equal(outcome.createdProject, false);
});

test("Deployment Target pipeline creates a new Project before GitHub task", async () => {
  const events: string[] = [];
  const outcome = await runDeploymentTargetPipeline({
    adapters: testAdapters({
      createGithubDeployTask: (input) => {
        events.push(`task:${input.projectName}:${input.projectUid ?? ""}`);
        return Promise.resolve({
          message: "Deploy task task-9 queued.",
          taskId: "task-9",
        });
      },
      fetchProjectUidByName: (name) => {
        events.push(`fetch:${name}`);
        return Promise.resolve("project-uid-9");
      },
      onApplyYaml: () => {
        events.push("apply");
      },
    }),
    credentialsReady: true,
    existingProjects,
    namespace: "ns-admin",
    projectCompositionRows,
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
    "apply",
    "fetch:project-a",
    "task:project-a:project-uid-9",
  ]);
  assert.equal(outcome.kind, "github");
  assert.equal(outcome.projectName, "project-a");
  assert.equal(outcome.projectUid, "project-uid-9");
  assert.equal(outcome.taskId, "task-9");
});

test("Deployment Target pipeline rejects duplicate new Project display names", async () => {
  await assert.rejects(
    runDeploymentTargetPipeline({
      adapters: testAdapters(),
      credentialsReady: true,
      existingProjects,
      namespace: "ns-admin",
      projectCompositionRows,
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
