import assert from "node:assert/strict";
import { test } from "node:test";
import YAML from "yaml";
import type {
  TemplateSourceInput,
  TemplateSourcePayload,
} from "./template-provider-core";
import {
  addTemplateInstanceOwnerReferences,
  generateTemplateInstanceOwnerReference,
  renderTemplateDeployment,
  renderTemplateDeploymentFromYaml,
  TemplateInputValidationError,
  type TemplateInputValidationErrorCode,
  type TemplateInputValidationValueSource,
  templateSourceFromInlineYaml,
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
const TEMPLATE_SECRET_NAME_RE = /secretName: wildcard-cert/;
const TEMPLATE_EXPR_MARKER_RE = /\$/;

function captureTemplateInputValidationError(input: {
  args?: Record<string, string>;
  declaration: TemplateSourceInput;
}): TemplateInputValidationError {
  try {
    renderTemplateDeployment({
      args: input.args,
      instanceName: "template-memos",
      namespace: "ns-admin",
      projectId: "project-uid",
      projectName: "project-uid",
      source: {
        ...source,
        source: { ...source.source, inputs: [input.declaration] },
      },
      templateName: "memos",
    });
  } catch (error) {
    assert.ok(error instanceof TemplateInputValidationError);
    return error;
  }
  throw new Error("Expected template input validation to fail.");
}

interface RenderedIngress {
  metadata?: {
    annotations?: Record<string, string>;
    labels?: Record<string, string>;
  };
  spec?: {
    rules?: Array<{ host?: string }>;
  };
}

interface RenderedStatefulSet {
  metadata?: { labels?: Record<string, string>; namespace?: string };
  spec?: {
    template?: {
      metadata?: { labels?: Record<string, string> };
    };
    volumeClaimTemplates?: Array<{
      metadata?: { labels?: Record<string, string> };
    }>;
  };
}

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
  const statefulSet = docs.find((doc) => doc.kind === "StatefulSet") as
    | RenderedStatefulSet
    | undefined;
  const ingress = docs.find((doc) => doc.kind === "Ingress") as
    | RenderedIngress
    | undefined;

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
    statefulSet?.metadata?.labels?.["brain.io/deployment-kind"],
    "template"
  );
  assert.equal(
    statefulSet?.metadata?.labels?.["brain.io/deployment-name"],
    "template-memos"
  );
  assert.equal(
    statefulSet?.metadata?.labels?.["cloud.sealos.io/app-deploy-manager"],
    "template-memos"
  );
  assert.equal(statefulSet?.metadata?.labels?.app, "template-memos");
  assert.equal(
    statefulSet?.spec?.template?.metadata?.labels?.["brain.io/deployment-kind"],
    "template"
  );
  assert.equal(
    statefulSet?.spec?.template?.metadata?.labels?.["brain.io/deployment-name"],
    "template-memos"
  );
  assert.equal(
    statefulSet?.spec?.template?.metadata?.labels?.[
      "cloud.sealos.io/app-deploy-manager"
    ],
    "template-memos"
  );
  assert.equal(
    statefulSet?.spec?.template?.metadata?.labels?.app,
    "template-memos"
  );
  assert.equal(
    statefulSet?.spec?.volumeClaimTemplates?.[0]?.metadata?.labels?.[
      "brain.io/project-id"
    ],
    "project-uid"
  );
  assert.equal(
    statefulSet?.spec?.volumeClaimTemplates?.[0]?.metadata?.labels?.[
      "brain.io/deployment-kind"
    ],
    "template"
  );
  assert.equal(
    statefulSet?.spec?.volumeClaimTemplates?.[0]?.metadata?.labels?.[
      "brain.io/deployment-name"
    ],
    "template-memos"
  );
  assert.equal(
    ingress?.metadata?.labels?.["brain.io/deployment-kind"],
    "template"
  );
  assert.equal(ingress?.spec?.rules?.[0]?.host, "memos-host.apps.example.com");

  const parsedInstance = YAML.parse(rendered.instanceYaml);
  assert.equal(parsedInstance.kind, "Instance");
  assert.equal(rendered.dependentYamls.length, 2);
});

test("renderTemplateDeployment assigns matching Services and Ingresses to template AP support resources", () => {
  const rendered = renderTemplateDeployment({
    args: { storage: "8" },
    instanceName: "template-web",
    namespace: "ns-admin",
    projectId: "project-uid",
    projectName: "project-uid",
    source: {
      ...source,
      appYaml: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-deploy
spec:
  selector:
    matchLabels:
      app: template-web
  template:
    metadata:
      labels:
        app: template-web
    spec:
      containers:
        - name: main
          image: nginx:1.27
          ports:
            - containerPort: 80
---
apiVersion: v1
kind: Service
metadata:
  name: template-web-service
spec:
  selector:
    app: template-web
  ports:
    - port: 80
      targetPort: 80
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: template-web
spec:
  rules:
    - host: template-web.apps.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: template-web-service
                port:
                  number: 80
`,
    },
    templateName: "web",
  });

  const deployment = rendered.resources.find(
    (doc) => doc.kind === "Deployment"
  ) as RenderedStatefulSet | undefined;
  const service = rendered.resources.find((doc) => doc.kind === "Service");
  const ingress = rendered.resources.find((doc) => doc.kind === "Ingress") as
    | RenderedIngress
    | undefined;

  assert.equal(
    deployment?.metadata?.labels?.["cloud.sealos.io/app-deploy-manager"],
    "template-web"
  );
  assert.equal(deployment?.metadata?.labels?.app, "template-web");
  assert.equal(
    deployment?.spec?.template?.metadata?.labels?.[
      "cloud.sealos.io/app-deploy-manager"
    ],
    "template-web"
  );
  assert.equal(
    service?.metadata?.labels?.["brain.io/deployment-kind"],
    "template"
  );
  assert.equal(
    service?.metadata?.labels?.["brain.io/deployment-name"],
    "template-web"
  );
  assert.equal(
    service?.metadata?.labels?.["cloud.sealos.io/app-deploy-manager"],
    "template-web"
  );
  assert.equal(
    ingress?.metadata?.labels?.["brain.io/deployment-kind"],
    "template"
  );
  assert.equal(
    ingress?.metadata?.labels?.["brain.io/deployment-name"],
    "template-web"
  );
  assert.equal(
    ingress?.metadata?.labels?.["cloud.sealos.io/app-deploy-manager"],
    "template-web"
  );
  assert.equal(
    ingress?.metadata?.labels?.["cloud.sealos.io/app-deploy-manager-domain"],
    "template-web"
  );
});

test("renderTemplateDeployment keeps ordinary workloads out of AP classification", () => {
  const rendered = renderTemplateDeployment({
    args: {},
    instanceName: "template-worker",
    namespace: "ns-admin",
    projectId: "project-uid",
    projectName: "project-uid",
    source: {
      ...source,
      appYaml: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: migration-worker
spec:
  selector:
    matchLabels:
      worker: migration
  template:
    metadata:
      labels:
        worker: migration
    spec:
      containers:
        - name: worker
          image: busybox:1.36
`,
    },
    templateName: "worker",
  });

  const deployment = rendered.resources.find(
    (doc) => doc.kind === "Deployment"
  );

  assert.equal(
    deployment?.metadata?.labels?.["cloud.sealos.io/app-deploy-manager"],
    undefined
  );
  assert.equal(
    deployment?.metadata?.labels?.["brain.io/deployment-kind"],
    "template"
  );
});

test("renderTemplateDeployment exposes KubeBlocks Clusters as Brain DB resources", () => {
  const rendered = renderTemplateDeployment({
    args: { storage: "8" },
    instanceName: "template-pg",
    namespace: "ns-admin",
    projectId: "project-uid",
    projectName: "project-uid",
    source: {
      ...source,
      appYaml: `apiVersion: apps.kubeblocks.io/v1alpha1
kind: Cluster
metadata:
  name: template-pg
  labels:
    clusterdefinition.kubeblocks.io/name: postgresql
spec:
  clusterDefinitionRef: postgresql
  clusterVersionRef: postgresql-16
  componentSpecs:
    - name: postgresql
      replicas: 1
      resources:
        limits:
          cpu: "1"
          memory: 1Gi
      volumeClaimTemplates:
        - name: data
          spec:
            resources:
              requests:
                storage: 8Gi
`,
    },
    templateName: "postgres",
  });

  const cluster = rendered.resources.find((doc) => doc.kind === "Cluster");
  const instance = rendered.resources.find((doc) => doc.kind === "Instance");

  assert.equal(
    instance?.metadata?.labels?.["brain.io/deployment-kind"],
    "template"
  );
  assert.equal(cluster?.metadata?.namespace, "ns-admin");
  assert.equal(
    cluster?.metadata?.labels?.["brain.io/project-id"],
    "project-uid"
  );
  assert.equal(
    cluster?.metadata?.labels?.["brain.io/deployment-kind"],
    "template"
  );
  assert.equal(cluster?.metadata?.labels?.["brain.io/managed-by"], "brain");
  assert.equal(
    cluster?.metadata?.labels?.["cloud.sealos.io/deploy-on-sealos"],
    "template-pg"
  );
  assert.equal(
    cluster?.metadata?.labels?.["app.kubernetes.io/instance"],
    "template-pg"
  );
  assert.equal(
    cluster?.metadata?.labels?.["clusterdefinition.kubeblocks.io/name"],
    "postgresql"
  );
  assert.equal(
    cluster?.metadata?.labels?.["clusterversion.kubeblocks.io/name"],
    "postgresql-16"
  );
});

test("renderTemplateDeployment normalizes KubeBlocks Clusters without provider labels", () => {
  const rendered = renderTemplateDeployment({
    args: { storage: "8" },
    instanceName: "template-mysql",
    namespace: "ns-admin",
    projectId: "project-uid",
    projectName: "project-uid",
    source: {
      ...source,
      appYaml: `apiVersion: apps.kubeblocks.io/v1alpha1
kind: Cluster
metadata:
  name: template-mysql
spec:
  clusterDefinitionRef: apecloud-mysql
  clusterVersionRef: apecloud-mysql-8.0
  componentSpecs:
    - name: mysql
      replicas: 1
`,
    },
    templateName: "mysql",
  });

  const cluster = rendered.resources.find((doc) => doc.kind === "Cluster");

  assert.equal(
    cluster?.metadata?.labels?.["app.kubernetes.io/instance"],
    "template-mysql"
  );
  assert.equal(
    cluster?.metadata?.labels?.["clusterdefinition.kubeblocks.io/name"],
    "apecloud-mysql"
  );
  assert.equal(
    cluster?.metadata?.labels?.["clusterversion.kubeblocks.io/name"],
    "apecloud-mysql-8.0"
  );
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

  const ingress = rendered.resources.find((doc) => doc.kind === "Ingress") as
    | RenderedIngress
    | undefined;
  assert.equal(
    ingress?.spec?.rules?.[0]?.host,
    "memos-host.192.168.10.189.nip.io"
  );
});

test("renderTemplateDeployment disables ssl redirect for HTTP-only template ingress", () => {
  const rendered = renderTemplateDeployment({
    args: { storage: "8" },
    instanceName: "template-web",
    namespace: "ns-admin",
    projectId: "project-uid",
    projectName: "project-uid",
    source: {
      ...source,
      appYaml: `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: template-web
  annotations:
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    nginx.ingress.kubernetes.io/configuration-snippet: |
      proxy_set_header X-Forwarded-Proto https;
spec:
  rules:
    - host: template-web.192.168.10.189.nip.io
`,
    },
    templateName: "web",
  });

  const ingress = rendered.resources.find((doc) => doc.kind === "Ingress") as
    | RenderedIngress
    | undefined;
  assert.equal(
    ingress?.metadata?.annotations?.[
      "nginx.ingress.kubernetes.io/ssl-redirect"
    ],
    "false"
  );
  assert.equal(
    ingress?.metadata?.annotations?.[
      "nginx.ingress.kubernetes.io/configuration-snippet"
    ],
    undefined
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

test("template input failures expose only the rejected key and stable code", () => {
  const cases: Array<{
    args?: Record<string, string>;
    code: TemplateInputValidationErrorCode;
    declaration: TemplateSourceInput;
    valueSource: TemplateInputValidationValueSource;
  }> = [
    {
      code: "required",
      declaration: { key: "storage", required: true, type: "string" },
      valueSource: "missing",
    },
    {
      args: { storage: "8\ninjected" },
      code: "single-line",
      declaration: { key: "storage", required: true, type: "string" },
      valueSource: "provided",
    },
    {
      args: { storage: "large" },
      code: "option",
      declaration: {
        key: "storage",
        options: ["small", "medium"],
        required: true,
        type: "string",
      },
      valueSource: "provided",
    },
    {
      args: { storage: "many" },
      code: "number",
      declaration: { key: "storage", required: true, type: "number" },
      valueSource: "provided",
    },
    {
      args: { storage: "sometimes" },
      code: "boolean",
      declaration: { key: "storage", required: true, type: "boolean" },
      valueSource: "provided",
    },
    {
      args: { storage: "" },
      code: "number",
      declaration: {
        default: "invalid-default",
        key: "storage",
        required: true,
        type: "number",
      },
      valueSource: "default",
    },
  ];

  for (const testCase of cases) {
    const error = captureTemplateInputValidationError(testCase);
    assert.equal(error.inputKey, "storage");
    assert.equal(error.code, testCase.code);
    assert.equal(error.valueSource, testCase.valueSource);
  }
});

test("renderTemplateDeploymentFromYaml renders inline Sealos Template documents", () => {
  const rendered = renderTemplateDeploymentFromYaml({
    certSecretName: "wildcard-cert",
    instanceName: "template-inline",
    namespace: "ns-admin",
    projectId: "project-uid",
    projectName: "project-uid",
    routingDomain: "apps.example.com",
    templateYaml: `
apiVersion: app.sealos.io/v1
kind: Template
metadata:
  name: inline-web
spec:
  title: Inline Web
  templateType: inline
  defaults:
    app_host:
      type: string
      value: inline
    app_name:
      type: string
      value: inline-web
    generated_from_input:
      type: string
      value: \${{ inputs.storage }}
  inputs:
    storage:
      type: number
      default: 1
---
apiVersion: v1
kind: Service
metadata:
  name: \${{ defaults.app_name }}
spec:
  ports:
    - port: 80
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: \${{ defaults.app_name }}
spec:
  rules:
    - host: \${{ defaults.app_host }}.\${{ SEALOS_CLOUD_DOMAIN }}
  tls:
    - secretName: \${{ SEALOS_CERT_SECRET_NAME }}
`,
  });

  const instance = YAML.parse(rendered.instanceYaml);
  const service = rendered.resources.find((doc) => doc.kind === "Service");
  const ingressYaml = rendered.dependentYamls.find((raw) =>
    raw.includes("kind: Ingress")
  );

  assert.equal(instance.kind, "Instance");
  assert.equal(instance.metadata.name, "template-inline");
  assert.equal(instance.spec.defaults.generated_from_input.value, 1);
  assert.equal(service?.metadata?.name, "template-inline");
  assert.match(ingressYaml ?? "", TEMPLATE_SECRET_NAME_RE);
});

test("renderTemplateDeployment keeps declaration-only input fields off Instance", () => {
  const templateYaml = `
apiVersion: app.sealos.io/v1
kind: Template
metadata:
  name: mastodon
spec:
  title: Mastodon
  inputs:
    registrations_mode:
      default: approved
      description: Who can create accounts
      options:
        - approved
        - open
      required: true
      type: string
---
apiVersion: v1
kind: Service
metadata:
  name: mastodon
spec:
  ports:
    - port: 80
`;
  const { source: template, templateName } =
    templateSourceFromInlineYaml(templateYaml);
  const rendered = renderTemplateDeployment({
    instanceName: "mastodon",
    namespace: "ns-admin",
    projectId: "project-uid",
    projectName: "project-uid",
    source: template,
    templateName,
  });
  const instance = YAML.parse(rendered.instanceYaml);

  assert.deepEqual(template.source.inputs?.[0]?.options, ["approved", "open"]);
  assert.deepEqual(instance.spec.inputs.registrations_mode, {
    default: "approved",
    description: "Who can create accounts",
    required: true,
    type: "string",
  });
});

test("renderTemplateDeploymentFromYaml renders base64 expressions with JSON braces", () => {
  const rendered = renderTemplateDeploymentFromYaml({
    instanceName: "seakills-site-ayzvaa",
    namespace: "ns-admin",
    projectId: "project-uid",
    projectName: "g6",
    templateYaml: `
apiVersion: app.sealos.io/v1
kind: Template
metadata:
  name: seakills-site
spec:
  title: Seakills Site
  templateType: inline
  defaults:
    app_name:
      type: string
      value: seakills-site
---
apiVersion: v1
kind: Secret
metadata:
  name: \${{ defaults.app_name }}
type: kubernetes.io/dockerconfigjson
stringData:
  .dockerconfigjson: \${{ base64('{"auths":{"example.io":{"auth":"' + base64('demo:token') + '"}}}') }}
`,
  });

  const secret = rendered.resources.find((doc) => doc.kind === "Secret");
  const typedSecret = secret as {
    data?: Record<string, string>;
    stringData?: Record<string, string>;
  };
  const encoded = typedSecret.data?.[".dockerconfigjson"];

  assert.ok(encoded);
  assert.doesNotMatch(encoded, TEMPLATE_EXPR_MARKER_RE);
  assert.equal(typedSecret.stringData?.[".dockerconfigjson"], undefined);

  const dockerConfig = JSON.parse(Buffer.from(encoded, "base64").toString());
  assert.deepEqual(dockerConfig, {
    auths: {
      "example.io": {
        auth: Buffer.from("demo:token").toString("base64"),
      },
    },
  });
});

test("renderTemplateDeploymentFromYaml skips inactive conditional required inputs", () => {
  const rendered = renderTemplateDeploymentFromYaml({
    args: { auth_enabled: "false" },
    instanceName: "conditional-web",
    namespace: "ns-admin",
    projectId: "project-uid",
    projectName: "project-uid",
    templateYaml: `
apiVersion: app.sealos.io/v1
kind: Template
metadata:
  name: conditional-web
spec:
  title: Conditional Web
  templateType: inline
  inputs:
    auth_enabled:
      type: boolean
      default: "false"
    auth_secret:
      required: true
      type: secret
      if: inputs.auth_enabled == "true"
---
apiVersion: v1
kind: Service
metadata:
  name: conditional-web
spec:
  ports:
    - port: 80
`,
  });

  assert.ok(rendered.resources.some((doc) => doc.kind === "Service"));
});
