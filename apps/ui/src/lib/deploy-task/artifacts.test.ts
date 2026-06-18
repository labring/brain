import assert from "node:assert/strict";
import { test } from "node:test";
import YAML from "yaml";

import {
  blockingInputsFromDeploymentPlan,
  createSealosTemplateDeploymentPlan,
  type DeployTaskArtifactContext,
  prepareDeployTaskArtifacts,
  prepareSealosTemplateArtifact,
  sealosTemplateArtifactSummary,
} from "./artifacts";

const UNSUPPORTED_ARTIFACT_REGEX = /Unsupported deploy artifact/;
const MISSING_PROJECT_NAME_REGEX = /without a Project name/;
const UNSUPPORTED_AP_SCHEMA_REGEX = /spec\.input\.image/;
const FAILED_DEPLOYMENT_OUTPUT_REGEX = /Build failed/;
const FAILED_BUILD_RESULT_REGEX = /Image build failed/;
const IMAGE_MISMATCH_REGEX = /workload image does not match/;
const MISSING_BUILD_DIGEST_REGEX = /missing image\.digest/;
const RENDERED_INSTANCE_REGEX = /kind: Instance/;
const RENDERED_HOST_REGEX = /host: demo.cloud.sealos.io/;
const UNSUPPORTED_TEMPLATE_KIND_REGEX =
  /blocked Kubernetes kind ClusterRoleBinding/;

const TEMPLATE_WITH_REQUIRED_INPUT = `
apiVersion: app.sealos.io/v1
kind: Template
metadata:
  name: ai-gateway
spec:
  title: AI Gateway
  templateType: inline
  inputs:
    ai_gateway_api_key:
      label: AI Gateway API key
      description: API key for the gateway
      required: true
      type: secret
    enable_cache:
      label: Enable cache
      required: false
      type: boolean
      default: "false"
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ai-gateway
spec:
  selector:
    matchLabels:
      app: ai-gateway
  template:
    metadata:
      labels:
        app: ai-gateway
    spec:
      containers:
        - name: web
          image: registry.example.com/demo/web@sha256:abc123
          env:
            - name: AI_GATEWAY_API_KEY
              value: \${{ inputs.ai_gateway_api_key }}
`;

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

test("prepareSealosTemplateArtifact renders native Sealos template outputs", () => {
  const artifact = prepareSealosTemplateArtifact({
    buildResult: {
      image: {
        digest: "sha256:abc123",
        image_ref: "registry.example.com/demo/web@sha256:abc123",
      },
      kubernetes: {
        job: "build-demo",
        namespace: "tenant-a",
        pod: "build-demo-pod",
      },
      mode: "kaniko",
      status: "succeeded",
    },
    deliveryManifest: {
      app: { name: "demo-web" },
      outputs: {
        buildResult: ".sealos/build-result.json",
        template: ".sealos/template/index.yaml",
      },
    },
    routingDomain: "cloud.sealos.io",
    task: task(),
    templateYaml: `
apiVersion: app.sealos.io/v1
kind: Template
metadata:
  name: demo-web
spec:
  title: Demo Web
  templateType: inline
  defaults:
    app_host:
      type: string
      value: demo
    app_name:
      type: string
      value: demo-web
  inputs:
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: \${{ defaults.app_name }}
spec:
  selector:
    matchLabels:
      app: \${{ defaults.app_name }}
  template:
    metadata:
      labels:
        app: \${{ defaults.app_name }}
    spec:
      containers:
        - name: web
          image: registry.example.com/demo/web@sha256:abc123
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: \${{ defaults.app_name }}
spec:
  rules:
    - host: \${{ defaults.app_host }}.\${{ SEALOS_CLOUD_DOMAIN }}
`,
  });

  assert.equal(artifact.kind, "sealos-template");
  assert.equal(artifact.templateName, "demo-web");
  assert.equal(artifact.instanceName, "demo-project");
  assert.equal(artifact.rendered.resources[0]?.kind, "Instance");

  const summary = sealosTemplateArtifactSummary({ artifact });
  assert.equal(summary.resources?.length, 3);
  assert.match(summary.resourceYamls?.[0] ?? "", RENDERED_INSTANCE_REGEX);
  assert.match(summary.resourceYamls?.[0] ?? "", RENDERED_HOST_REGEX);
  assert.equal(
    (
      summary.artifacts?.[0] as {
        build?: { image?: string | null };
      }
    ).build?.image,
    "registry.example.com/demo/web@sha256:abc123"
  );
});

test("createSealosTemplateDeploymentPlan reports missing required inputs", () => {
  const plan = createSealosTemplateDeploymentPlan({
    deliveryManifest: { args: {} },
    templateYaml: TEMPLATE_WITH_REQUIRED_INPUT,
  });

  assert.deepEqual(plan.missingInputKeys, ["ai_gateway_api_key"]);
  assert.equal(plan.inputs.length, 2);
  assert.equal(plan.inputs[0]?.sensitive, true);

  const blockingInputs = blockingInputsFromDeploymentPlan(plan);
  assert.deepEqual(blockingInputs, [
    {
      description: "API key for the gateway",
      id: "ai_gateway_api_key",
      key: "ai_gateway_api_key",
      label: "AI Gateway API key",
      required: true,
      sensitive: true,
      type: "secret",
      valueType: "secret",
    },
  ]);
});

test("prepareSealosTemplateArtifact uses build evidence over success spelling", () => {
  const artifact = prepareSealosTemplateArtifact({
    buildResult: {
      image: {
        digest: "sha256:abc123",
        image_ref: "registry.example.com/demo/web@sha256:abc123",
      },
      status: "success",
    },
    deliveryManifest: {},
    task: task(),
    templateYaml: `
apiVersion: app.sealos.io/v1
kind: Template
metadata:
  name: demo-web
spec:
  templateType: inline
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: demo-web
spec:
  selector:
    matchLabels:
      app: demo-web
  template:
    metadata:
      labels:
        app: demo-web
    spec:
      containers:
        - name: web
          image: registry.example.com/demo/web@sha256:abc123
`,
  });

  assert.equal(artifact.build.status, "succeeded");
  assert.equal(artifact.build.statusRaw, "success");
});

test("prepareSealosTemplateArtifact rejects failed image builds", () => {
  assert.throws(
    () =>
      prepareSealosTemplateArtifact({
        buildResult: {
          error: { message: "Image build failed" },
          status: "failed",
        },
        deliveryManifest: {},
        task: task(),
        templateYaml: `
apiVersion: app.sealos.io/v1
kind: Template
metadata:
  name: demo-web
spec:
  templateType: inline
---
apiVersion: v1
kind: Service
metadata:
  name: demo-web
`,
      }),
    FAILED_BUILD_RESULT_REGEX
  );
});

test("prepareSealosTemplateArtifact requires build digest for workload images", () => {
  assert.throws(
    () =>
      prepareSealosTemplateArtifact({
        buildResult: {
          image: {
            image_ref: "registry.example.com/demo/web@sha256:abc123",
          },
          status: "succ",
        },
        deliveryManifest: {},
        task: task(),
        templateYaml: `
apiVersion: app.sealos.io/v1
kind: Template
metadata:
  name: demo-web
spec:
  templateType: inline
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: demo-web
spec:
  selector:
    matchLabels:
      app: demo-web
  template:
    metadata:
      labels:
        app: demo-web
    spec:
      containers:
        - name: web
          image: registry.example.com/demo/web@sha256:abc123
`,
      }),
    MISSING_BUILD_DIGEST_REGEX
  );
});

test("prepareSealosTemplateArtifact allows namespaced runtime support resources", () => {
  const artifact = prepareSealosTemplateArtifact({
    buildResult: {
      status: "skipped",
    },
    deliveryManifest: {},
    task: task(),
    templateYaml: `
apiVersion: app.sealos.io/v1
kind: Template
metadata:
  name: demo-web
spec:
  templateType: inline
---
apiVersion: v1
kind: Secret
metadata:
  name: demo-web
type: kubernetes.io/dockerconfigjson
data:
  .dockerconfigjson: e30=
---
apiVersion: batch/v1
kind: Job
metadata:
  name: demo-web-init
spec:
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: init
          image: busybox
          command: ["true"]
---
apiVersion: batch/v1
kind: CronJob
metadata:
  name: demo-web-sync
spec:
  schedule: "*/5 * * * *"
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: Never
          containers:
            - name: sync
              image: busybox
              command: ["true"]
`,
  });

  assert.deepEqual(
    artifact.rendered.resources.map((resource) => resource.kind),
    ["Instance", "Secret", "Job", "CronJob"]
  );
});

test("prepareSealosTemplateArtifact rejects cluster permission template resource kinds", () => {
  assert.throws(
    () =>
      prepareSealosTemplateArtifact({
        buildResult: {
          status: "skipped",
        },
        deliveryManifest: {},
        task: task(),
        templateYaml: `
apiVersion: app.sealos.io/v1
kind: Template
metadata:
  name: demo-web
spec:
  templateType: inline
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: demo-admin
`,
      }),
    UNSUPPORTED_TEMPLATE_KIND_REGEX
  );
});

test("prepareSealosTemplateArtifact requires workload images to match build result", () => {
  assert.throws(
    () =>
      prepareSealosTemplateArtifact({
        buildResult: {
          image: {
            digest: "sha256:good",
            image_ref: "registry.example.com/demo/web@sha256:good",
          },
          status: "succeeded",
        },
        deliveryManifest: {},
        task: task(),
        templateYaml: `
apiVersion: app.sealos.io/v1
kind: Template
metadata:
  name: demo-web
spec:
  templateType: inline
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: demo-web
spec:
  selector:
    matchLabels:
      app: demo-web
  template:
    metadata:
      labels:
        app: demo-web
    spec:
      containers:
        - name: web
          image: registry.example.com/demo/web:mutable
`,
      }),
    IMAGE_MISMATCH_REGEX
  );
});
