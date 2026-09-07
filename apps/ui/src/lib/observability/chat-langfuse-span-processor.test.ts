import assert from "node:assert/strict";
import { test } from "node:test";
import { LangfuseVercelAiSdkIntegration } from "@langfuse/vercel-ai-sdk";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { generateText, simulateReadableStream, streamText, tool } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";

import { ChatLangfuseSpanProcessor } from "./chat-langfuse-span-processor";

type ReadableSpan = Parameters<ChatLangfuseSpanProcessor["onEnd"]>[0];
const SECRET = "SYNTHETIC_SECRET_IN_REMOTE_ERROR";
const usage = {
  inputTokens: {
    total: 1,
    noCache: 1,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

test("Langfuse exports error codes and metrics without remote error content", async () => {
  const exported: ReadableSpan[] = [];
  const original: ReadableSpan[] = [];
  const processor = new ChatLangfuseSpanProcessor({
    exporter: {
      export(spans, complete) {
        exported.push(...spans);
        complete({ code: 0 });
      },
      shutdown: () => Promise.resolve(),
    },
    exportMode: "immediate",
    mediaUploadEnabled: false,
  });
  const sdk = new NodeSDK({
    spanProcessors: [
      {
        onStart: () => undefined,
        onEnd: (span) => original.push(span),
        forceFlush: () => Promise.resolve(),
        shutdown: () => Promise.resolve(),
      },
      processor,
    ],
  });
  sdk.start();
  const telemetry = {
    integrations: [new LangfuseVercelAiSdkIntegration()],
    recordInputs: false,
    recordOutputs: false,
  };
  try {
    const failedTool = await generateText({
      model: new MockLanguageModelV3({
        doGenerate: async () => ({
          content: [
            {
              type: "tool-call",
              toolCallId: "read-1",
              toolName: "readFile",
              input: "{}",
            },
          ],
          finishReason: { unified: "tool-calls", raw: undefined },
          usage,
          warnings: [],
        }),
      }),
      prompt: SECRET,
      tools: {
        readFile: tool({
          inputSchema: z.object({}),
          execute: (): Promise<string> =>
            Promise.reject(new Error(`Devbox file read failed: ${SECRET}`)),
        }),
      },
      telemetry,
    });
    assert.equal(failedTool.toolResults.length, 0);

    const failedStream = streamText({
      model: new MockLanguageModelV3({
        doStream: () => Promise.reject(new Error(`Provider failed: ${SECRET}`)),
      }),
      maxRetries: 0,
      prompt: SECRET,
      telemetry,
      onError: () => undefined,
    });
    let sawStreamError = false;
    for await (const chunk of failedStream.fullStream) {
      sawStreamError ||= chunk.type === "error";
    }
    assert.ok(sawStreamError);

    const success = streamText({
      model: new MockLanguageModelV3({
        doStream: async () => ({
          stream: simulateReadableStream({
            chunks: [
              { type: "text-start" as const, id: "text-1" },
              { type: "text-delta" as const, id: "text-1", delta: SECRET },
              { type: "text-end" as const, id: "text-1" },
              {
                type: "finish" as const,
                finishReason: { unified: "stop" as const, raw: undefined },
                usage,
              },
            ],
          }),
        }),
      }),
      prompt: SECRET,
      telemetry,
    });
    assert.equal(await success.text, SECRET);
    await processor.forceFlush();

    const payload = (spans: ReadableSpan[]) =>
      JSON.stringify(
        spans.map((span) => ({
          attributes: span.attributes,
          events: span.events,
          status: span.status,
        }))
      );
    // The other processor still sees the original errors; redaction must not
    // mutate the SDK span or alter what Chat delivers to its caller.
    assert.ok(payload(original).includes(SECRET));
    assert.equal(payload(exported).includes(SECRET), false);
    const toolSpan = exported.find(
      (span) => span.attributes["gen_ai.tool.name"] === "readFile"
    );
    assert.ok(toolSpan);
    assert.equal(toolSpan.status.code, 2);
    assert.equal(toolSpan.attributes["gen_ai.tool.call.id"], "read-1");
    assert.ok(toolSpan.parentSpanContext);
    assert.ok(toolSpan.duration[0] >= 0);
    assert.ok(
      exported.some(
        (span) =>
          span.status.code !== 2 &&
          span.attributes["gen_ai.usage.input_tokens"] === 1
      )
    );
    assert.ok(exported.filter((span) => span.status.code === 2).length >= 2);
  } finally {
    await sdk.shutdown();
  }
});
