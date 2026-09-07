import { spyOn } from "bun:test";
import assert from "node:assert/strict";
import { test } from "node:test";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { LangfuseVercelAiSdkIntegration } from "@langfuse/vercel-ai-sdk";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  consumeStream,
  generateText,
  simulateReadableStream,
  streamText,
  tool,
} from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";

import { ChatLangfuseSpanProcessor } from "./chat-langfuse-span-processor";
import { type ChatTrace, withLangfuseChatTrace } from "./chat-trace";

type ReadableSpan = Parameters<ChatLangfuseSpanProcessor["onEnd"]>[0];
const TOOL_SECRET = "SYNTHETIC_SECRET_IN_TOOL_INPUT";
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
              input: JSON.stringify({ command: TOOL_SECRET }),
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
          inputSchema: z.object({ command: z.string() }),
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
    let releaseTitle: () => void = () => undefined;
    let titleStarted: () => void = () => undefined;
    const titleGate = new Promise<void>((resolve) => {
      releaseTitle = resolve;
    });
    const started = new Promise<void>((resolve) => {
      titleStarted = resolve;
    });
    let turnTrace: ChatTrace | undefined;
    const response = await withLangfuseChatTrace({
      chatId: "stream-session",
      chatTurnId: "stream-turn",
      userId: "stream-user",
      callback: (trace) => {
        turnTrace = trace;
        const result = streamText({
          model: new MockLanguageModelV3({
            doStream: async () => ({
              stream: simulateReadableStream({
                chunks: [
                  {
                    type: "tool-call" as const,
                    toolCallId: "stream-read",
                    toolName: "inspect",
                    input: JSON.stringify({ command: TOOL_SECRET }),
                  },
                  {
                    type: "finish" as const,
                    finishReason: {
                      unified: "tool-calls" as const,
                      raw: undefined,
                    },
                    usage,
                  },
                ],
              }),
            }),
          }),
          prompt: SECRET,
          tools: {
            inspect: tool({
              inputSchema: z.object({ command: z.string() }),
              execute: async () => TOOL_SECRET,
            }),
          },
          telemetry,
        });
        return result.toUIMessageStreamResponse({
          consumeSseStream: async ({ stream }) => {
            try {
              await consumeStream({ stream });
            } finally {
              trace.end();
            }
          },
          onFinish: async () => {
            titleStarted();
            await titleGate;
            await generateText({
              model: new MockLanguageModelV3({
                doGenerate: async () => ({
                  content: [{ type: "text", text: "Synthetic title" }],
                  finishReason: { unified: "stop", raw: undefined },
                  usage,
                  warnings: [],
                }),
              }),
              prompt: SECRET,
              telemetry: {
                ...telemetry,
                functionId: "project-assistant-thread-title",
              },
            });
          },
        });
      },
    });
    // Consume outside the callback's synchronous context, like Next does.
    const drained = response.text();
    await started;
    assert.ok(turnTrace);
    let completed = false;
    const completion = turnTrace.completed.then(() => {
      completed = true;
    });
    await processor.forceFlush();
    assert.equal(completed, false);
    assert.equal(
      exported.some((span) => span.name === "project-assistant-chat"),
      false
    );
    // Resolve the first turn's title gate while a different user's trace is
    // active. Async propagation must keep the first turn's tags and trace ID.
    await withLangfuseChatTrace({
      chatId: "other-session",
      chatTurnId: "other-turn",
      userId: "other-user",
      callback: async (trace) => {
        try {
          await generateText({
            model: new MockLanguageModelV3({
              doGenerate: async () => ({
                content: [{ type: "text", text: "Other turn" }],
                finishReason: { unified: "stop", raw: undefined },
                usage,
                warnings: [],
              }),
            }),
            prompt: SECRET,
            telemetry,
          });
          releaseTitle();
          await drained;
        } finally {
          trace.end();
        }
      },
    });
    await completion;
    await processor.forceFlush();
    const turnSpans = exported.filter(
      (span) => span.attributes["session.id"] === "stream-session"
    );
    assert.ok(turnSpans.some((span) => span.name === "project-assistant-chat"));
    assert.ok(
      turnSpans.some(
        (span) => span.attributes["gen_ai.tool.name"] === "inspect"
      )
    );
    assert.ok(
      turnSpans.some(
        (span) =>
          span.attributes["gen_ai.agent.name"] ===
          "project-assistant-thread-title"
      )
    );
    assert.equal(
      new Set(turnSpans.map((span) => span.spanContext().traceId)).size,
      1
    );
    assert.ok(
      turnSpans.every((span) => span.attributes["user.id"] === "stream-user")
    );

    const otherSpans = exported.filter(
      (span) => span.attributes["session.id"] === "other-session"
    );
    assert.ok(otherSpans.length >= 2);
    assert.ok(
      otherSpans.every((span) => span.attributes["user.id"] === "other-user")
    );
    assert.equal(
      new Set(
        [...turnSpans, ...otherSpans].map((span) => span.spanContext().traceId)
      ).size,
      2
    );

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
    assert.equal(payload(exported).includes(TOOL_SECRET), false);
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
    const onEnd = spyOn(
      LangfuseSpanProcessor.prototype,
      "onEnd"
    ).mockImplementation(() => {
      throw new Error("exporter failure");
    });
    try {
      assert.doesNotThrow(() => processor.onEnd(toolSpan));
      assert.equal(onEnd.mock.calls.length, 1);
    } finally {
      onEnd.mockRestore();
    }
  } finally {
    await sdk.shutdown();
  }
});
