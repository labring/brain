import { expect, mock, test } from "bun:test";
import type { UIMessage } from "ai";
import { MockLanguageModelV3 } from "ai/test";

// The module under test is marked `server-only`; neutralize it (repo pattern),
// then load it dynamically so the mock is registered before evaluation.
mock.module("server-only", () => ({}));
const { deriveThreadTitle } = await import("./title");

function userMessage(text: string): UIMessage {
  return { id: "msg-user", role: "user", parts: [{ type: "text", text }] };
}

const MOCK_USAGE = {
  inputTokens: {
    total: 1,
    noCache: 1,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

/** Mock model that records the prompt and replies with a fixed title. */
function titleModel(capture: { prompts: unknown[] }) {
  return new MockLanguageModelV3({
    doGenerate: (options) => {
      capture.prompts.push(options.prompt);
      return Promise.resolve({
        content: [{ type: "text" as const, text: "Generated Title" }],
        finishReason: { unified: "stop" as const, raw: undefined },
        usage: MOCK_USAGE,
        warnings: [],
      });
    },
  });
}

function promptText(prompt: unknown): string {
  return JSON.stringify(prompt);
}

test("deriveThreadTitle hands the project name to the model as a fact", async () => {
  const capture = { prompts: [] as unknown[] };
  const title = await deriveThreadTitle({
    languageModel: titleModel(capture),
    messages: [userMessage("why is the pod crash-looping?")],
    projectName: "blog-api",
  });
  expect(title).toBe("Generated Title");
  const sent = promptText(capture.prompts[0]);
  expect(sent).toContain("Current project: blog-api");
  expect(sent).toContain("why is the pod crash-looping?");
});

test("deriveThreadTitle omits the project preamble when no project is set", async () => {
  const capture = { prompts: [] as unknown[] };
  await deriveThreadTitle({
    languageModel: titleModel(capture),
    messages: [userMessage("compare memory usage across services")],
  });
  expect(promptText(capture.prompts[0])).not.toContain("Current project:");
});

test("deriveThreadTitle treats a blank project name as absent", async () => {
  const capture = { prompts: [] as unknown[] };
  await deriveThreadTitle({
    languageModel: titleModel(capture),
    messages: [userMessage("hello")],
    projectName: "   ",
  });
  expect(promptText(capture.prompts[0])).not.toContain("Current project:");
});

test("deriveThreadTitle falls back to the first user words when the model fails", async () => {
  const failing = new MockLanguageModelV3({
    doGenerate: () => Promise.reject(new Error("model down")),
  });
  const title = await deriveThreadTitle({
    languageModel: failing,
    messages: [userMessage("restart the ingress controller for me")],
    projectName: "blog-api",
  });
  expect(title).toBe("restart the ingress controller for me");
});

test("deriveThreadTitle falls back to 'Chat' when there is no user text", async () => {
  const capture = { prompts: [] as unknown[] };
  const title = await deriveThreadTitle({
    languageModel: titleModel(capture),
    messages: [],
  });
  expect(title).toBe("Chat");
  expect(capture.prompts.length).toBe(0);
});
