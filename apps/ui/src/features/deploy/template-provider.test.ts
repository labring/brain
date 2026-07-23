import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  deployTemplateInstance,
  getTemplateSource,
  listTemplateCatalog,
} from "./template-provider-core";

const originalFetch = globalThis.fetch;
const originalProviderUrl = process.env.TEMPLATE_PROVIDER_URL;
const MISSING_PROVIDER_URL_RE = /TEMPLATE_PROVIDER_URL is not configured/;
const NESTED_PROVIDER_ERROR_RE = /statefulsets\.apps "affine" is invalid/;
const PROVIDER_KUBERNETES_DIAGNOSTIC =
  'deployments.apps "affine" is forbidden: exceeded quota: limits.cpu';

function restoreGlobals() {
  globalThis.fetch = originalFetch;
  if (originalProviderUrl === undefined) {
    delete process.env.TEMPLATE_PROVIDER_URL;
  } else {
    process.env.TEMPLATE_PROVIDER_URL = originalProviderUrl;
  }
}

afterEach(restoreGlobals);

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status: 200,
    ...init,
  });
}

test("listTemplateCatalog maps Sealos provider templates to Brain choices", async () => {
  process.env.TEMPLATE_PROVIDER_URL = "https://template.example.com";
  let requestedUrl = "";
  let requestedInit: RequestInit | undefined;
  globalThis.fetch = ((url, init) => {
    requestedUrl = String(url);
    requestedInit = init;
    return Promise.resolve(
      jsonResponse({
        code: 200,
        data: {
          menuKeys: "database",
          templates: [
            {
              apiVersion: "app.sealos.io/v1",
              kind: "Template",
              metadata: { name: "memos" },
              spec: {
                categories: ["database"],
                description: "Memos app",
                gitRepo: "https://github.com/usememos/memos",
                icon: "https://example.com/icon.png",
                inputs: {
                  storage: {
                    default: "5",
                    description: "Storage size",
                    required: true,
                    type: "number",
                  },
                },
                readme: "https://example.com/readme.md",
                title: "memos",
              },
            },
          ],
        },
      })
    );
  }) as typeof fetch;

  const catalog = await listTemplateCatalog({ language: "zh" });

  assert.equal(
    requestedUrl,
    "https://template.example.com/api/listTemplate?language=zh"
  );
  assert.deepEqual(requestedInit, {
    next: { revalidate: 300 },
  });
  assert.deepEqual(catalog, [
    {
      args: [
        {
          default: "5",
          description: "Storage size",
          key: "storage",
          required: true,
          type: "number",
        },
      ],
      category: ["database"],
      description: "Memos app",
      icon: "https://example.com/icon.png",
      name: "memos",
      readme: "https://example.com/readme.md",
      sourceRepos: ["https://github.com/usememos/memos"],
      title: "memos",
    },
  ]);
});

test("listTemplateCatalog maps localized legacy template fields", async () => {
  process.env.TEMPLATE_PROVIDER_URL = "https://template.example.com";
  globalThis.fetch = (() =>
    Promise.resolve(
      jsonResponse({
        code: 200,
        data: {
          templates: [
            {
              metadata: { name: "localized" },
              spec: {
                description: "中文描述",
                gitRepo: "https://github.com/example/base",
                icon: "https://example.com/icon.png",
                i18n: {
                  en: {
                    description: "English description",
                    gitRepo: "https://github.com/example/en",
                    icon: "https://example.com/icon-en.png",
                    readme: "https://example.com/readme-en.md",
                    title: "Localized EN",
                  },
                },
                inputs: {},
                readme: "https://example.com/readme.md",
                title: "Localized",
              },
            },
          ],
        },
      })
    )) as unknown as typeof fetch;

  const catalog = await listTemplateCatalog({ language: "en" });

  assert.deepEqual(catalog[0], {
    args: [],
    category: [],
    description: "English description",
    icon: "https://example.com/icon-en.png",
    name: "localized",
    readme: "https://example.com/readme-en.md",
    sourceRepos: ["https://github.com/example/en"],
    title: "Localized EN",
  });
});

test("listTemplateCatalog requires TEMPLATE_PROVIDER_URL", async () => {
  delete process.env.TEMPLATE_PROVIDER_URL;

  await assert.rejects(listTemplateCatalog(), MISSING_PROVIDER_URL_RE);
});

test("getTemplateSource loads render source from provider API", async () => {
  process.env.TEMPLATE_PROVIDER_URL = "https://template.example.com/";
  let requestedUrl = "";
  let requestedInit: RequestInit | undefined;
  globalThis.fetch = ((url, init) => {
    requestedUrl = String(url);
    requestedInit = init;
    return Promise.resolve(
      jsonResponse({
        code: 200,
        data: {
          appYaml: "apiVersion: v1\nkind: Service\nmetadata:\n  name: memos",
          source: {
            defaults: {
              app_name: { type: "string", value: "memos" },
            },
            inputs: [],
            SEALOS_CLOUD_DOMAIN: "apps.example.com",
          },
          templateYaml: {
            apiVersion: "app.sealos.io/v1",
            kind: "Template",
            spec: { title: "memos" },
          },
        },
      })
    );
  }) as typeof fetch;

  const result = await getTemplateSource({
    encodedKubeconfig:
      "apiVersion: v1\nclusters:\n- cluster:\n    server: https://example.com",
    language: "zh",
    templateName: "memos",
  });

  assert.equal(
    requestedUrl,
    "https://template.example.com/api/getTemplateSource?includeReadme=false&locale=zh&templateName=memos"
  );
  assert.equal(requestedInit?.method, "GET");
  assert.equal(
    (requestedInit?.headers as Record<string, string>).Authorization,
    "apiVersion%3A%20v1%0Aclusters%3A%0A-%20cluster%3A%0A%20%20%20%20server%3A%20https%3A%2F%2Fexample.com"
  );
  assert.equal(result.appYaml.includes("kind: Service"), true);
  assert.deepEqual(result.source.defaults?.app_name, {
    type: "string",
    value: "memos",
  });
});

test("getTemplateSource preserves already encoded kubeconfig authorization", async () => {
  process.env.TEMPLATE_PROVIDER_URL = "https://template.example.com/";
  let requestedInit: RequestInit | undefined;
  globalThis.fetch = ((_url, init) => {
    requestedInit = init;
    return Promise.resolve(
      jsonResponse({
        code: 200,
        data: {
          appYaml: "apiVersion: v1\nkind: Service\nmetadata:\n  name: memos",
          source: { inputs: [] },
          templateYaml: { apiVersion: "app.sealos.io/v1", kind: "Template" },
        },
      })
    );
  }) as typeof fetch;

  await getTemplateSource({
    encodedKubeconfig:
      "apiVersion%3A%20v1%0Aclusters%3A%0A-%20cluster%3A%0A%20%20%20%20server%3A%20https%3A%2F%2Fexample.com",
    templateName: "memos",
  });

  assert.equal(
    (requestedInit?.headers as Record<string, string>).Authorization,
    "apiVersion%3A%20v1%0Aclusters%3A%0A-%20cluster%3A%0A%20%20%20%20server%3A%20https%3A%2F%2Fexample.com"
  );
});

test("deployTemplateInstance posts args and Brain labels to provider", async () => {
  process.env.TEMPLATE_PROVIDER_URL = "https://template.example.com/";
  let requestedUrl = "";
  let requestedInit: RequestInit | undefined;
  globalThis.fetch = ((url, init) => {
    requestedUrl = String(url);
    requestedInit = init;
    return Promise.resolve(
      jsonResponse(
        {
          name: "n8n-demo",
          resources: [
            {
              name: "n8n-demo",
              resourceType: "app",
              uid: "resource-uid",
            },
          ],
          uid: "instance-uid",
        },
        { status: 201 }
      )
    );
  }) as typeof fetch;

  const result = await deployTemplateInstance({
    args: {
      timezone: "Asia/Shanghai",
    },
    encodedKubeconfig:
      "apiVersion: v1\nclusters:\n- cluster:\n    server: https://example.com",
    extraLabels: {
      "brain.io/managed-by": "brain",
      "brain.io/project-id": "project-uid",
      "brain.io/deployment-kind": "template",
      "brain.io/deployment-name": "n8n-demo",
      "brain.io/template-name": "n8n",
    },
    instanceName: "n8n-demo",
    templateName: "n8n",
  });

  assert.equal(
    requestedUrl,
    "https://template.example.com/api/v2alpha/templates/instances"
  );
  assert.equal(requestedInit?.method, "POST");
  assert.equal(
    (requestedInit?.headers as Record<string, string>).Authorization,
    "apiVersion%3A%20v1%0Aclusters%3A%0A-%20cluster%3A%0A%20%20%20%20server%3A%20https%3A%2F%2Fexample.com"
  );
  assert.deepEqual(JSON.parse(String(requestedInit?.body)), {
    args: {
      timezone: "Asia/Shanghai",
    },
    extraLabels: {
      "brain.io/managed-by": "brain",
      "brain.io/project-id": "project-uid",
      "brain.io/deployment-kind": "template",
      "brain.io/deployment-name": "n8n-demo",
      "brain.io/template-name": "n8n",
    },
    name: "n8n-demo",
    template: "n8n",
  });
  assert.deepEqual(result, {
    instanceName: "n8n-demo",
    resources: [
      {
        name: "n8n-demo",
        resourceType: "app",
        uid: "resource-uid",
      },
    ],
  });
});

test("deployTemplateInstance surfaces nested provider errors", async () => {
  process.env.TEMPLATE_PROVIDER_URL = "https://template.example.com/";
  globalThis.fetch = (() =>
    Promise.resolve(
      jsonResponse(
        {
          code: 500,
          data: {
            error: {
              message: 'statefulsets.apps "affine" is invalid',
            },
          },
        },
        { status: 500 }
      )
    )) as unknown as typeof fetch;

  await assert.rejects(
    () =>
      deployTemplateInstance({
        encodedKubeconfig: "kubeconfig",
        instanceName: "affine-demo",
        templateName: "affine",
      }),
    NESTED_PROVIDER_ERROR_RE
  );
});

test("deployTemplateInstance prefers the provider Kubernetes diagnostic", async () => {
  process.env.TEMPLATE_PROVIDER_URL = "https://template.example.com/";
  globalThis.fetch = (() =>
    Promise.resolve(
      jsonResponse(
        {
          error: {
            details: PROVIDER_KUBERNETES_DIAGNOSTIC,
            message: "Failed to create instance in Kubernetes.",
          },
        },
        { status: 500 }
      )
    )) as unknown as typeof fetch;

  await assert.rejects(
    () =>
      deployTemplateInstance({
        encodedKubeconfig: "kubeconfig",
        instanceName: "affine-demo",
        templateName: "affine",
      }),
    (error: Error) => {
      assert.equal(error.message, PROVIDER_KUBERNETES_DIAGNOSTIC);
      return true;
    }
  );
});
