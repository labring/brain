import { describe, expect, it } from "bun:test";

import {
  DEPLOY_INTENT_CONTEXT_PART_TYPE,
  type DeployIntentContext,
  deployIntentEnvelopeSchema,
  deployIntentPromptText,
  readDeployIntentContext,
} from "./deploy-intent-context";

function messageWithIntent(
  data: unknown,
  extraParts: Array<{ data?: unknown; type: string }> = []
) {
  return {
    id: "u-1",
    parts: [
      ...extraParts,
      { type: DEPLOY_INTENT_CONTEXT_PART_TYPE, data },
      { type: "text", text: "Deploy from a shared link." },
    ],
    role: "user",
  };
}

const templateIntent: DeployIntentContext = {
  version: 1,
  kind: "template",
  source: "template-site",
  payload: { templateName: "glpi", args: { admin_email: "a@example.com" } },
};

const githubIntent: DeployIntentContext = {
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

const topicIntent: DeployIntentContext = {
  version: 1,
  kind: "topic",
  source: "blog",
  payload: { query: "deploy a helpdesk", ref: "https://blog.example.com/glpi" },
};

describe("deployIntentEnvelopeSchema", () => {
  it("accepts a version-1 template intent", () => {
    const parsed = deployIntentEnvelopeSchema.safeParse(templateIntent);
    expect(parsed.success).toBe(true);
  });

  it("accepts a version-1 github intent", () => {
    const parsed = deployIntentEnvelopeSchema.safeParse(githubIntent);
    expect(parsed.success).toBe(true);
  });

  it("accepts a version-1 topic intent", () => {
    const parsed = deployIntentEnvelopeSchema.safeParse(topicIntent);
    expect(parsed.success).toBe(true);
  });

  it("rejects an unknown version", () => {
    expect(
      deployIntentEnvelopeSchema.safeParse({ ...templateIntent, version: 2 })
        .success
    ).toBe(false);
  });

  it("rejects an unknown kind", () => {
    expect(
      deployIntentEnvelopeSchema.safeParse({
        ...templateIntent,
        kind: "evil",
      }).success
    ).toBe(false);
  });

  it("rejects a kind/payload mismatch", () => {
    expect(
      deployIntentEnvelopeSchema.safeParse({
        ...githubIntent,
        payload: templateIntent.payload,
      }).success
    ).toBe(false);
  });

  it("rejects an oversized source", () => {
    expect(
      deployIntentEnvelopeSchema.safeParse({
        ...templateIntent,
        source: "x".repeat(1025),
      }).success
    ).toBe(false);
  });

  it("trims a blank templateName away (rejected)", () => {
    expect(
      deployIntentEnvelopeSchema.safeParse({
        ...templateIntent,
        payload: { templateName: "   " },
      }).success
    ).toBe(false);
  });

  it("rejects an oversized template args record", () => {
    const args: Record<string, string> = {};
    for (let index = 0; index < 65; index += 1) {
      args[`key-${index}`] = "value";
    }
    expect(
      deployIntentEnvelopeSchema.safeParse({
        ...templateIntent,
        payload: { templateName: "glpi", args },
      }).success
    ).toBe(false);
  });

  it("rejects a non-URL github repo url", () => {
    expect(
      deployIntentEnvelopeSchema.safeParse({
        ...githubIntent,
        payload: {
          repo: { ...githubIntent.payload.repo, url: "not-a-url" },
        },
      }).success
    ).toBe(false);
  });

  it("collapses newlines in a topic query", () => {
    const parsed = deployIntentEnvelopeSchema.safeParse({
      ...topicIntent,
      payload: { query: "deploy\nhelpdesk\r\nnow" },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.kind === "topic") {
      expect(parsed.data.payload.query).toBe("deploy helpdesk now");
    }
  });

  it("rejects a topic query that is blank after normalization", () => {
    expect(
      deployIntentEnvelopeSchema.safeParse({
        ...topicIntent,
        payload: { query: "\n  \n" },
      }).success
    ).toBe(false);
  });
});

describe("readDeployIntentContext", () => {
  it("reads a single valid intent part", () => {
    const intent = readDeployIntentContext(messageWithIntent(templateIntent));
    expect(intent).not.toBeNull();
    expect(intent?.kind).toBe("template");
    expect(
      intent?.kind === "template" ? intent.payload.templateName : null
    ).toBe("glpi");
  });

  it("returns null when no intent part exists", () => {
    const message = {
      id: "u-1",
      parts: [{ type: "text", text: "hi" }],
      role: "user",
    };
    expect(
      readDeployIntentContext(message as { parts: readonly unknown[] })
    ).toBeNull();
  });

  it("rejects repeated intent parts", () => {
    expect(
      readDeployIntentContext(
        messageWithIntent(templateIntent, [
          { type: DEPLOY_INTENT_CONTEXT_PART_TYPE, data: topicIntent },
        ])
      )
    ).toBeNull();
  });

  it("rejects a malformed intent part", () => {
    expect(
      readDeployIntentContext(
        messageWithIntent({ version: 1, kind: "template", payload: {} })
      )
    ).toBeNull();
  });
});

describe("deployIntentPromptText", () => {
  it("renders a short transcript line per kind", () => {
    expect(deployIntentPromptText(templateIntent)).toContain('"glpi"');
    expect(deployIntentPromptText(githubIntent)).toContain("glpi-project/glpi");
    expect(deployIntentPromptText(githubIntent)).toContain("branch main");
    expect(deployIntentPromptText(topicIntent)).toContain("deploy a helpdesk");
  });
});
