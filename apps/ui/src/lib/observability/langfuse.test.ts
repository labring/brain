import { expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
let shutdowns = 0;
mock.module("@opentelemetry/sdk-node", () => ({
  NodeSDK: class {
    start() {
      /* Simulate a started SDK without global registration. */
    }
    shutdown() {
      shutdowns += 1;
      return Promise.resolve();
    }
  },
}));
mock.module("./chat-langfuse-span-processor", () => ({
  ChatLangfuseSpanProcessor: class {},
}));
mock.module("@langfuse/vercel-ai-sdk", () => ({
  LangfuseVercelAiSdkIntegration: class {},
}));
mock.module("ai", () => ({
  registerTelemetry: () => {
    throw new Error("registration failed");
  },
}));

const {
  initializeLangfuseTelemetry,
  isLangfuseTelemetryEnabled,
  flushLangfuseTelemetry,
} = await import("./langfuse");

test("failed integration registration disables telemetry and shuts down the SDK", async () => {
  const previous = {
    LANGFUSE_BASE_URL: process.env.LANGFUSE_BASE_URL,
    LANGFUSE_PUBLIC_KEY: process.env.LANGFUSE_PUBLIC_KEY,
    LANGFUSE_SECRET_KEY: process.env.LANGFUSE_SECRET_KEY,
  };
  try {
    Object.assign(process.env, {
      LANGFUSE_BASE_URL: "https://langfuse.example.test",
      LANGFUSE_PUBLIC_KEY: "pk-test",
      LANGFUSE_SECRET_KEY: "sk-test",
    });
    expect(await initializeLangfuseTelemetry()).toBe(false);
    expect(isLangfuseTelemetryEnabled()).toBe(false);
    await flushLangfuseTelemetry();
    expect(shutdowns).toBe(1);
    expect(await initializeLangfuseTelemetry()).toBe(false);
    expect(shutdowns).toBe(1);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});
