import assert from "node:assert/strict";
import { test } from "node:test";
import YAML from "yaml";

import {
  type DeployTaskArtifactContext,
  prepareDeployTaskArtifacts,
} from "./artifacts";

const UNSUPPORTED_ARTIFACT_REGEX = /Unsupported deploy artifact/;
const MISSING_PROJECT_NAME_REGEX = /without a Project name/;
const UNSUPPORTED_AP_SCHEMA_REGEX = /spec\.input\.image/;
const FAILED_DEPLOYMENT_OUTPUT_REGEX = /Build failed/;

function task(
  overrides: Partial<DeployTaskArtifactContext> = {}
): DeployTaskArtifactContext {
  return {
    namespace: "tenant-a",
    projectName: "demo-project",
    projectId: "project-uid",
    ...overrides,
  };
}

test("prepareDeployTaskArtifacts normalizes supported Brain direct manifests", () => {
  const result = prepareDeployTaskArtifacts({
    output: {
      deploymentOutput: {
        image: "ghcr.io/example/web:latest",
        status: "succeeded",
      },
      resourceYamls: [
        `
apiVersion: brain.io/direct
kind: AP
metadata:
  name: web
  namespace: wrong
spec:
  input:
    image: nginx
`,
      ],
    },
    task: task(),
  });

  assert.equal(result.resources.length, 1);
  assert.deepEqual(result.resources[0], {
    apiVersion: "brain.io/direct",
    kind: "AP",
    name: "web",
    namespace: "tenant-a",
  });

  const doc = YAML.parse(result.yaml) as Record<string, unknown>;
  assert.equal((doc.metadata as { namespace?: string }).namespace, "tenant-a");
  assert.equal((doc.spec as { projectId?: string }).projectId, "project-uid");
  assert.equal((doc.spec as { projectName?: string }).projectName, undefined);
  assert.equal(
    (doc.metadata as { labels?: Record<string, string> }).labels?.[
      "brain.io/project-id"
    ],
    "project-uid"
  );
});

test("prepareDeployTaskArtifacts rejects failed deployment-output contracts", () => {
  assert.throws(
    () =>
      prepareDeployTaskArtifacts({
        output: {
          deploymentOutput: {
            error: "Build failed",
            status: "failed",
          },
          resourceYamls: [
            `
apiVersion: brain.io/direct
kind: AP
metadata:
  name: web
spec:
  input:
    image: nginx
`,
          ],
        },
        task: task(),
      }),
    FAILED_DEPLOYMENT_OUTPUT_REGEX
  );
});

test("prepareDeployTaskArtifacts rejects retired AP top-level image schema", () => {
  assert.throws(
    () =>
      prepareDeployTaskArtifacts({
        output: {
          resourceYamls: [
            `
apiVersion: brain.io/direct
kind: AP
metadata:
  name: web
spec:
  image: nginx
  ports:
    - 80
`,
          ],
        },
        task: task(),
      }),
    UNSUPPORTED_AP_SCHEMA_REGEX
  );
});

test("prepareDeployTaskArtifacts rejects unsupported resources", () => {
  assert.throws(
    () =>
      prepareDeployTaskArtifacts({
        output: {
          resourceYamls: [
            `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: raw
`,
          ],
        },
        task: task(),
      }),
    UNSUPPORTED_ARTIFACT_REGEX
  );
});

test("prepareDeployTaskArtifacts requires project name before apply", () => {
  assert.throws(
    () =>
      prepareDeployTaskArtifacts({
        output: {
          resourceYamls: [
            `
apiVersion: brain.io/direct
kind: DB
metadata:
  name: pg
`,
          ],
        },
        task: task({ projectName: null }),
      }),
    MISSING_PROJECT_NAME_REGEX
  );
});
