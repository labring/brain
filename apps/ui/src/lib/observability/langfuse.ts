import "server-only";

import { LangfuseSpanProcessor } from "@langfuse/otel";
import { propagateAttributes } from "@langfuse/tracing";
import { LangfuseVercelAiSdkIntegration } from "@langfuse/vercel-ai-sdk";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { registerTelemetry } from "ai";

import {
  getLangfuseConfigFromEnv,
  isLangfusePartiallyConfiguredFromEnv,
} from "./langfuse-core";

let initialization: Promise<boolean> | undefined;

/**
 * Starts the Langfuse OpenTelemetry exporter once per Node.js process.
 * Observability is deliberately fail-open: bad or unavailable Langfuse
 * configuration must never prevent Brain from serving chat or other routes.
 */
export function initializeLangfuseTelemetry(): Promise<boolean> {
  initialization ??= Promise.resolve().then(() => {
    if (isLangfusePartiallyConfiguredFromEnv(process.env)) {
      console.warn(
        "[observability] LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY must both be set; Chat Assistant telemetry is disabled."
      );
      return false;
    }

    const config = getLangfuseConfigFromEnv(process.env);
    if (config == null) {
      return false;
    }

    try {
      const spanProcessor = new LangfuseSpanProcessor({
        publicKey: config.publicKey,
        secretKey: config.secretKey,
        baseUrl: config.baseUrl,
      });
      const sdk = new NodeSDK({ spanProcessors: [spanProcessor] });
      sdk.start();
      registerTelemetry(new LangfuseVercelAiSdkIntegration());
      console.info(
        `[observability] Chat Assistant telemetry enabled (${config.baseUrl}).`
      );
      return true;
    } catch (error) {
      console.warn(
        "[observability] Langfuse telemetry failed to initialize; continuing without telemetry:",
        error
      );
      return false;
    }
  });

  return initialization;
}

export function withLangfuseChatTrace<T>(input: {
  chatId: string;
  runId: string;
  userId: string;
  callback: () => T;
}): T {
  return propagateAttributes(
    {
      traceName: "project-assistant-chat",
      sessionId: input.chatId,
      userId: input.userId,
      metadata: {
        feature: "project-assistant",
        agentRunId: input.runId,
      },
    },
    input.callback
  );
}
