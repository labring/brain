import { beforeEach, expect, mock, test } from "bun:test";

let failure:
  | "propagate"
  | "start"
  | "after-start"
  | "context"
  | "end"
  | undefined;
let ends = 0;
mock.module("@langfuse/tracing", () => ({
  propagateAttributes: (_attributes: unknown, callback: () => unknown) => {
    if (failure === "propagate") {
      throw new Error("telemetry unavailable");
    }
    return callback();
  },
  startActiveObservation: async (
    _name: string,
    callback: (observation: { end: () => void }) => unknown
  ) => {
    if (failure === "start") {
      throw new Error("telemetry unavailable");
    }
    const result = await callback({
      end: () => {
        ends += 1;
        if (failure === "end") {
          throw new Error("telemetry unavailable");
        }
      },
    });
    if (failure === "after-start") {
      throw new Error("telemetry unavailable");
    }
    return result;
  },
}));
mock.module("@opentelemetry/api", () => ({
  context: {
    active: () => ({}),
    with: (_context: unknown, callback: () => unknown) => {
      if (failure === "context") {
        throw new Error("context unavailable");
      }
      return callback();
    },
  },
}));
const { withLangfuseChatTrace } = await import("./chat-trace");
const attributes = { chatId: "chat", chatTurnId: "turn", userId: "user" };
beforeEach(() => {
  failure = undefined;
  ends = 0;
});

for (const mode of [
  "propagate",
  "start",
  "after-start",
  "context",
  "end",
] as const) {
  test(`telemetry failure at ${mode} does not fail or replay application work`, async () => {
    failure = mode;
    let calls = 0;
    const response = await withLangfuseChatTrace({
      ...attributes,
      callback: async (trace) => {
        const result = trace.run(() => {
          calls += 1;
          return "response";
        });
        trace.end();
        trace.end();
        await trace.completed;
        return result;
      },
    });
    expect(response).toBe("response");
    expect(calls).toBe(1);
    expect(ends).toBe(mode === "propagate" || mode === "start" ? 0 : 1);
  });
}

for (const asyncFailure of [false, true]) {
  test(`application ${asyncFailure ? "async" : "sync"} failure is preserved without retry`, async () => {
    let calls = 0;
    const error = new Error("application failure");
    await expect(
      withLangfuseChatTrace({
        ...attributes,
        callback: (trace) =>
          trace.run(() => {
            calls += 1;
            if (asyncFailure) {
              return Promise.reject(error);
            }
            throw error;
          }),
      })
    ).rejects.toBe(error);
    expect(calls).toBe(1);
    expect(ends).toBe(1);
  });
}
