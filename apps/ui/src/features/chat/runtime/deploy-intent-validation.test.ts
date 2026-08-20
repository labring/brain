import { describe, expect, it, mock } from "bun:test";
import type { UIMessage } from "ai";

import { DEPLOY_INTENT_CONTEXT_PART_TYPE } from "@/features/chat/persistence/deploy-intent-context";
import type { TemplateCatalogItem } from "@/features/deploy/template-provider-core";

mock.module("server-only", () => ({}));
const { sanitizeDeployIntentParts, validateDeployIntentPayload } = await import(
  "./deploy-intent-validation"
);

function catalogItem(
  overrides: Partial<TemplateCatalogItem> & { name: string }
): TemplateCatalogItem {
  return {
    args: [],
    category: [],
    description: "",
    icon: "",
    readme: "",
    sourceRepos: [],
    title: overrides.name,
    ...overrides,
  };
}

const glpiCatalogItem = catalogItem({
  args: [
    {
      description: "GLPI admin email",
      key: "admin_email",
      required: true,
      type: "string",
    },
    {
      description: "GLPI admin password",
      key: "admin_password",
      required: true,
      type: "password",
    },
    {
      description: "Replicas",
      key: "replicas",
      required: false,
      type: "number",
    },
  ],
  name: "glpi",
});

function userMessage(data: unknown, count = 1): UIMessage {
  const parts: UIMessage["parts"] = [];
  for (let index = 0; index < count; index += 1) {
    parts.push({ type: DEPLOY_INTENT_CONTEXT_PART_TYPE, data });
  }
  parts.push({ type: "text", text: "Deploy from a shared link." });
  return {
    id: "u-1",
    parts,
    role: "user",
  } as unknown as UIMessage;
}

function intentParts(message: UIMessage): unknown[] {
  return message.parts.filter(
    (part) =>
      part != null &&
      typeof part === "object" &&
      (part as { type?: unknown }).type === DEPLOY_INTENT_CONTEXT_PART_TYPE
  );
}

const validTemplateEnvelope = {
  version: 1,
  kind: "template",
  source: "template-site",
  payload: { templateName: "glpi", args: { admin_email: "a@example.com" } },
};

const validGithubEnvelope = {
  version: 1,
  kind: "github",
  source: "github",
  payload: {
    repo: {
      fullName: "glpi-project/glpi",
      name: "glpi",
      url: "https://github.com/glpi-project/glpi",
    },
    branch: "main",
  },
};

describe("validateDeployIntentPayload", () => {
  it("accepts a template whose name exists in the catalog", async () => {
    const result = await validateDeployIntentPayload(validTemplateEnvelope, {
      listTemplateCatalog: () => Promise.resolve([glpiCatalogItem]),
    });
    expect(result?.kind).toBe("template");
    expect(
      result?.kind === "template" ? result.payload.templateName : null
    ).toBe("glpi");
  });

  it("rejects a forged template name not in the catalog", async () => {
    await expect(
      validateDeployIntentPayload(
        {
          ...validTemplateEnvelope,
          payload: { templateName: "malware" },
        },
        { listTemplateCatalog: () => Promise.resolve([glpiCatalogItem]) }
      )
    ).resolves.toBeNull();
  });

  it("drops the intent when the template catalog is unavailable", async () => {
    await expect(
      validateDeployIntentPayload(validTemplateEnvelope, {
        listTemplateCatalog: () =>
          Promise.reject(new Error("TEMPLATE_PROVIDER_URL is not configured.")),
      })
    ).resolves.toBeNull();
  });

  it("strips sensitive args and keeps declared non-sensitive args", async () => {
    const result = await validateDeployIntentPayload(
      {
        ...validTemplateEnvelope,
        payload: {
          templateName: "glpi",
          args: {
            admin_email: "a@example.com",
            admin_password: "hunter2",
          },
        },
      },
      { listTemplateCatalog: () => Promise.resolve([glpiCatalogItem]) }
    );
    expect(result?.kind).toBe("template");
    if (result?.kind !== "template") {
      return;
    }
    expect(result.payload.args).toEqual({ admin_email: "a@example.com" });
  });

  it("rejects undeclared args fail-closed", async () => {
    await expect(
      validateDeployIntentPayload(
        {
          ...validTemplateEnvelope,
          payload: {
            templateName: "glpi",
            args: { not_declared: "x" },
          },
        },
        { listTemplateCatalog: () => Promise.resolve([glpiCatalogItem]) }
      )
    ).resolves.toBeNull();
  });

  it("rejects args that fail the declared type check", async () => {
    await expect(
      validateDeployIntentPayload(
        {
          ...validTemplateEnvelope,
          payload: {
            templateName: "glpi",
            args: { replicas: "many" },
          },
        },
        { listTemplateCatalog: () => Promise.resolve([glpiCatalogItem]) }
      )
    ).resolves.toBeNull();
    const result = await validateDeployIntentPayload(
      {
        ...validTemplateEnvelope,
        payload: {
          templateName: "glpi",
          args: { replicas: "3" },
        },
      },
      { listTemplateCatalog: () => Promise.resolve([glpiCatalogItem]) }
    );
    expect(result?.kind === "template" ? result.payload.args : null).toEqual({
      replicas: "3",
    });
  });

  it("rejects a sensitive arg key that is not declared at all", async () => {
    await expect(
      validateDeployIntentPayload(
        {
          ...validTemplateEnvelope,
          payload: {
            templateName: "glpi",
            args: { api_token: "sekret" },
          },
        },
        { listTemplateCatalog: () => Promise.resolve([glpiCatalogItem]) }
      )
    ).resolves.toBeNull();
  });

  it("accepts a github intent with a legal HTTPS github.com URL", async () => {
    const result = await validateDeployIntentPayload(validGithubEnvelope);
    expect(result?.kind).toBe("github");
  });

  it("rejects a github intent whose url is not HTTPS github.com", async () => {
    for (const url of [
      "http://github.com/glpi-project/glpi",
      "https://gitlab.com/glpi-project/glpi",
      "https://github.com/glpi-project",
      "https://github.com/glpi-project/glpi/issues",
      "https://evil.com/glpi-project/glpi",
    ]) {
      await expect(
        validateDeployIntentPayload({
          ...validGithubEnvelope,
          payload: {
            repo: { ...validGithubEnvelope.payload.repo, url },
          },
        })
      ).resolves.toBeNull();
    }
  });

  it("rejects a github intent whose fullName does not match its url", async () => {
    await expect(
      validateDeployIntentPayload({
        ...validGithubEnvelope,
        payload: {
          repo: {
            ...validGithubEnvelope.payload.repo,
            fullName: "other/other",
          },
        },
      })
    ).resolves.toBeNull();
  });

  it("accepts a topic intent with bounded free text", async () => {
    const result = await validateDeployIntentPayload({
      version: 1,
      kind: "topic",
      source: "blog",
      payload: {
        query: "deploy a helpdesk",
        ref: "https://blog.example.com/x",
      },
    });
    expect(result?.kind).toBe("topic");
    if (result?.kind === "topic") {
      expect(result.payload.query).toBe("deploy a helpdesk");
      expect(result.payload.ref).toBe("https://blog.example.com/x");
    }
  });

  it("rejects a topic intent that is blank or oversized", async () => {
    await expect(
      validateDeployIntentPayload({
        version: 1,
        kind: "topic",
        source: "blog",
        payload: { query: "   " },
      })
    ).resolves.toBeNull();
    await expect(
      validateDeployIntentPayload({
        version: 1,
        kind: "topic",
        source: "blog",
        payload: { query: "x".repeat(2001) },
      })
    ).resolves.toBeNull();
  });
});

describe("sanitizeDeployIntentParts", () => {
  it("keeps one validated intent and normalizes its payload", async () => {
    const message = userMessage({
      ...validTemplateEnvelope,
      payload: {
        templateName: "glpi",
        args: { admin_email: "a@example.com", admin_password: "sekret" },
      },
    });
    const sanitized = await sanitizeDeployIntentParts(message, {
      listTemplateCatalog: () => Promise.resolve([glpiCatalogItem]),
    });
    const parts = intentParts(sanitized);
    expect(parts).toHaveLength(1);
    const data = (parts[0] as { data?: { payload?: { args?: unknown } } }).data;
    expect(data?.payload?.args).toEqual({ admin_email: "a@example.com" });
  });

  it("drops all intent parts when there is more than one", async () => {
    const message = userMessage(validTemplateEnvelope, 2);
    const sanitized = await sanitizeDeployIntentParts(message, {
      listTemplateCatalog: () => Promise.resolve([glpiCatalogItem]),
    });
    expect(intentParts(sanitized)).toHaveLength(0);
    expect(sanitized.parts).toHaveLength(1);
  });

  it("drops an invalid intent part without blocking the text", async () => {
    const message = userMessage({ version: 9, kind: "template", payload: {} });
    const sanitized = await sanitizeDeployIntentParts(message, {
      listTemplateCatalog: () => Promise.resolve([glpiCatalogItem]),
    });
    expect(intentParts(sanitized)).toHaveLength(0);
    expect(sanitized.parts).toHaveLength(1);
    expect((sanitized.parts[0] as { text?: string }).text).toContain(
      "Deploy from a shared link."
    );
  });

  it("leaves a message without intent parts untouched", async () => {
    const message = {
      id: "u-2",
      parts: [{ type: "text", text: "hello" }],
      role: "user",
    } as unknown as UIMessage;
    const sanitized = await sanitizeDeployIntentParts(message);
    expect(sanitized).toBe(message);
  });
});
