import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  getTemplateSource,
  listTemplateCatalog,
} from "./template-provider-core";

const originalFetch = globalThis.fetch;
const originalProviderUrl = process.env.TEMPLATE_PROVIDER_URL;
const MISSING_PROVIDER_URL_RE = /TEMPLATE_PROVIDER_URL is not configured/;

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
  globalThis.fetch = ((url) => {
    requestedUrl = String(url);
    return Promise.resolve(
      jsonResponse([
        {
          args: {
            storage: {
              default: "5",
              description: "Storage size",
              required: true,
              type: "number",
            },
          },
          category: ["database"],
          description: "Memos app",
          icon: "https://example.com/icon.png",
          name: "memos",
          readme: "https://example.com/readme.md",
        },
      ])
    );
  }) as typeof fetch;

  const catalog = await listTemplateCatalog({ language: "zh" });

  assert.equal(
    requestedUrl,
    "https://template.example.com/api/v2alpha/templates?language=zh"
  );
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
      title: "memos",
    },
  ]);
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
