import { mock } from "bun:test";
import assert from "node:assert/strict";
import { test } from "node:test";
import { convertToModelMessages } from "ai";

mock.module("server-only", () => ({}));
const { createTemplateReadmeTools, readTemplateReadmeInputSchema } =
  await import("./tool");
const options = {
  assistantContext: { kind: "project" as const, projectId: "project-a" },
  kubeconfig: "verified kubeconfig",
  kubernetesNamespace: "ns-a",
};

test("only Project chats get the README tool; the model cannot choose scope or URL", () => {
  assert.deepEqual(
    createTemplateReadmeTools({
      ...options,
      assistantContext: { kind: "workspace" },
    }),
    {}
  );
  for (const extra of [
    { projectId: "foreign" },
    { namespace: "foreign" },
    { url: "https://example.com" },
  ]) {
    assert.equal(
      readTemplateReadmeInputSchema.safeParse({
        intention: "Read usage",
        ...extra,
      }).success,
      false
    );
  }
});

test("README text reaches model context through the normal tool result", async () => {
  let received: unknown;
  const signal = new AbortController().signal;
  const tools = createTemplateReadmeTools(options, (request) => {
    received = request;
    return Promise.resolve({
      ok: true as const,
      templateName: "memos",
      content: "Create your first note.",
      truncated: false,
      trust: "external-documentation" as const,
    });
  });
  const tool = tools.readTemplateReadme;
  assert.ok(tool?.execute);
  const args = { intention: "Read usage", language: "zh" as const };
  const output = await tool.execute(args, {
    context: {},
    messages: [],
    toolCallId: "read-1",
    abortSignal: signal,
  });
  assert.deepEqual(received, {
    encodedKubeconfig: "verified%20kubeconfig",
    namespace: "ns-a",
    projectId: "project-a",
    language: "zh",
    templateName: undefined,
    signal,
  });
  const messages = await convertToModelMessages([
    {
      role: "assistant",
      parts: [
        {
          type: "tool-readTemplateReadme",
          toolCallId: "read-1",
          state: "output-available",
          input: args,
          output,
        },
      ],
    },
  ]);
  assert.ok(JSON.stringify(messages).includes("Create your first note."));
  assert.equal(typeof tool.description, "string");
  assert.ok(String(tool.description).includes("external documentation"));
});

test("provider failure becomes an ordinary result without internal error details", async () => {
  const tools = createTemplateReadmeTools(options, () =>
    Promise.reject(new Error("private-token"))
  );
  const result = await tools.readTemplateReadme?.execute?.(
    { intention: "Read usage" },
    { context: {}, messages: [], toolCallId: "read-2" }
  );
  assert.deepEqual(result, {
    ok: false,
    error: "Template README could not be loaded. Continue with other tools.",
  });
});

test("user cancellation propagates instead of becoming a provider failure", async () => {
  const controller = new AbortController();
  controller.abort();
  for (const [error, signal] of [
    [new DOMException("Stopped", "AbortError"), undefined],
    [new Error("custom cancellation reason"), controller.signal],
  ] as const) {
    const tools = createTemplateReadmeTools(options, () =>
      Promise.reject(error)
    );
    await assert.rejects(
      async () =>
        tools.readTemplateReadme?.execute?.(
          { intention: "Read usage" },
          {
            context: {},
            messages: [],
            toolCallId: "cancel",
            abortSignal: signal,
          }
        ),
      (caught) => caught === error
    );
  }
});

test("timeout and oversized payload return distinct actionable results", async () => {
  const { TemplateReadmePayloadTooLargeError } = await import(
    "@/features/deploy/template-provider-core"
  );
  for (const [error, expected] of [
    [
      new DOMException("Timed out", "TimeoutError"),
      "Template README retrieval timed out. You can retry.",
    ],
    [
      new TemplateReadmePayloadTooLargeError(),
      "Template Provider response exceeds 2 MiB (including YAML and README).",
    ],
  ] as const) {
    const tools = createTemplateReadmeTools(options, () =>
      Promise.reject(error)
    );
    const result = await tools.readTemplateReadme?.execute?.(
      { intention: "Read usage" },
      { context: {}, messages: [], toolCallId: "failure" }
    );
    assert.deepEqual(result, { ok: false, error: expected });
  }
});
