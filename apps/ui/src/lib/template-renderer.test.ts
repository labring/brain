import assert from "node:assert/strict";
import { test } from "node:test";
import YAML from "yaml";
import type { TemplateSourcePayload } from "./template-provider-core";
import {
  addTemplateInstanceOwnerReferences,
  generateTemplateInstanceOwnerReference,
  renderTemplateDeployment,
} from "./template-renderer";

const source = {
  appYaml: `apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: \${{ defaults.app_name }}
  labels:
    app: \${{ defaults.app_name }}
spec:
  replicas: 1
  selector:
    matchLabels:
      app: \${{ defaults.app_name }}
  template:
    metadata:
      labels:
        app: \${{ defaults.app_name }}
    spec:
      containers:
        - name: main
          image: ghcr.io/usememos/memos:latest
          env:
            - name: STORAGE
              value: \${{ inputs.storage }}
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        resources:
          requests:
            storage: \${{ inputs.storage }}Gi
---
\${{ if(inputs.enable_ingress === 'true') }}
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: \${{ defaults.app_name }}
spec:
  rules:
    - host: \${{ inputs.domain || defaults.app_host + '.' + SEALOS_CLOUD_DOMAIN }}
\${{ endif() }}
`,
  source: {
    defaults: {
      app_host: { type: "string", value: "memos-host" },
      app_name: { type: "string", value: "memos-default" },
    },
    inputs: [
      {
        default: "5",
        key: "storage",
        required: true,
        type: "number",
      },
      {
        default: "true",
        key: "enable_ingress",
        required: false,
        type: "boolean",
      },
      {
        default: "",
        key: "domain",
        required: false,
        type: "string",
      },
    ],
    SEALOS_CLOUD_DOMAIN: "apps.example.com",
  },
  templateYaml: {
    apiVersion: "app.sealos.io/v1",
    kind: "Template",
    spec: {
      defaults: {},
      description: "memos",
      inputs: {},
      title: "memos",
    },
  },
} satisfies TemplateSourcePayload;

const SINGLE_LINE_PARAMETER_RE =
  /Template parameter "storage" must be a single line/;
const NUMBER_PARAMETER_RE = /Template parameter "storage" must be a number/;

test("renderTemplateDeployment injects Brain labels into rendered resources", () => {
  const rendered = renderTemplateDeployment({
    args: { storage: "8" },
    instanceName: "template-memos",
    namespace: "ns-admin",
    projectId: "project-uid",
    projectName: "project-uid",
    source,
    templateName: "memos",
  });

  const docs = rendered.resources;
  const instance = docs.find((doc) => doc.kind === "Instance");
  const statefulSet = docs.find((doc) => doc.kind === "StatefulSet");
  const ingress = docs.find((doc) => doc.kind === "Ingress");

  assert.equal(instance?.metadata?.name, "template-memos");
  assert.equal(
    instance?.metadata?.labels?.["brain.io/project-id"],
    "project-uid"
  );
  assert.equal(
    instance?.metadata?.labels?.["cloud.sealos.io/owner-references"],
    "ready"
  );
  assert.equal(statefulSet?.metadata?.namespace, "ns-admin");
  assert.equal(
    statefulSet?.metadata?.labels?.["brain.io/project-id"],
    "project-uid"
  );
  assert.equal(
    (
      statefulSet?.spec?.volumeClaimTemplates as Array<{
        metadata?: { labels?: Record<string, string> };
      }>
    )[0]?.metadata?.labels?.["brain.io/project-id"],
    "project-uid"
  );
  assert.equal(ingress?.spec?.rules?.[0]?.host, "memos-host.apps.example.com");

  const parsedInstance = YAML.parse(rendered.instanceYaml);
  assert.equal(parsedInstance.kind, "Instance");
  assert.equal(rendered.dependentYamls.length, 2);
});

test("renderTemplateDeployment can override provider cloud domain with target cluster domain", () => {
  const rendered = renderTemplateDeployment({
    args: { storage: "8" },
    instanceName: "template-memos",
    namespace: "ns-admin",
    projectId: "project-uid",
    projectName: "project-uid",
    routingDomain: "192.168.10.189.nip.io",
    source,
    templateName: "memos",
  });

  const ingress = rendered.resources.find((doc) => doc.kind === "Ingress");
  assert.equal(
    ingress?.spec?.rules?.[0]?.host,
    "memos-host.192.168.10.189.nip.io"
  );
});

test("renderTemplateDeployment normalizes duplicate env names and Service containerPort fields", () => {
  const rendered = renderTemplateDeployment({
    args: { storage: "8" },
    instanceName: "template-dify",
    namespace: "ns-admin",
    projectId: "project-uid",
    projectName: "project-uid",
    source: {
      ...source,
      appYaml: `apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: template-dify-api
spec:
  selector:
    matchLabels:
      app: template-dify-api
  template:
    metadata:
      labels:
        app: template-dify-api
    spec:
      containers:
        - name: api
          image: dify/api:latest
          env:
            - name: DB_DATABASE
              value: dify
            - name: CONSOLE_API_URL
              value: https://api.example.com
            - name: DB_DATABASE
              value: dify_plugin
            - name: CONSOLE_API_URL
              value: https://api.example.com
---
apiVersion: v1
kind: Service
metadata:
  name: template-dify-plugin-daemon
spec:
  ports:
    - name: server-port
      port: 5002
      containerPort: 5003
`,
    },
    templateName: "dify",
  });

  const statefulSet = rendered.resources.find(
    (doc) => doc.kind === "StatefulSet"
  );
  const env = (
    statefulSet?.spec?.template as {
      spec?: {
        containers?: { env?: { name: string; value: string }[] }[];
      };
    }
  )?.spec?.containers?.[0]?.env;
  assert.deepEqual(env, [
    { name: "DB_DATABASE", value: "dify_plugin" },
    { name: "CONSOLE_API_URL", value: "https://api.example.com" },
  ]);

  const service = rendered.resources.find((doc) => doc.kind === "Service");
  const port = (
    service?.spec as {
      ports?: Record<string, unknown>[];
    }
  )?.ports?.[0];
  assert.equal(port?.containerPort, undefined);
  assert.equal(port?.targetPort, 5003);
});

test("renderTemplateDeployment reuses provider Instance instead of prepending a duplicate", () => {
  const rendered = renderTemplateDeployment({
    args: { storage: "8" },
    instanceName: "template-memos",
    namespace: "ns-admin",
    projectId: "project-uid",
    projectName: "project-uid",
    source: {
      ...source,
      appYaml: `apiVersion: app.sealos.io/v1
kind: Instance
metadata:
  name: provider-default
---
${source.appYaml}`,
    },
    templateName: "memos",
  });

  const instances = rendered.resources.filter((doc) => doc.kind === "Instance");
  assert.equal(instances.length, 1);
  assert.equal(instances[0]?.metadata?.name, "template-memos");
  assert.equal(rendered.dependentYamls.length, 2);
});

test("addTemplateInstanceOwnerReferences adds non-controller Instance owner", () => {
  const owner = generateTemplateInstanceOwnerReference(
    "template-memos",
    "uid-1"
  );
  const [resource] = addTemplateInstanceOwnerReferences(
    [
      {
        apiVersion: "apps/v1",
        kind: "StatefulSet",
        metadata: { name: "template-memos" },
      },
    ],
    owner
  );

  assert.deepEqual(resource?.metadata?.ownerReferences, [owner]);
});

test("renderTemplateDeployment rejects multi-line parameter values before YAML parsing", () => {
  assert.throws(
    () =>
      renderTemplateDeployment({
        args: {
          storage:
            "8\n---\napiVersion: v1\nkind: Secret\nmetadata:\n  name: injected",
        },
        instanceName: "template-memos",
        namespace: "ns-admin",
        projectId: "project-uid",
        projectName: "project-uid",
        source,
        templateName: "memos",
      }),
    SINGLE_LINE_PARAMETER_RE
  );
});

test("renderTemplateDeployment validates input type and option declarations", () => {
  assert.throws(
    () =>
      renderTemplateDeployment({
        args: { storage: "not-a-number" },
        instanceName: "template-memos",
        namespace: "ns-admin",
        projectId: "project-uid",
        projectName: "project-uid",
        source,
        templateName: "memos",
      }),
    NUMBER_PARAMETER_RE
  );
});
