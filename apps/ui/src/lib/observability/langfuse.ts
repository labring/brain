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
let langfuseSpanProcessor: LangfuseSpanProcessor | undefined;

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
      langfuseSpanProcessor = spanProcessor;
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

/**
 * Flushes pending Langfuse spans without ever affecting the request path.
 * This is used from Next.js `after()` for streaming responses, where a
 * short-lived instance may be frozen before the batch processor flushes.
 */
export async function flushLangfuseTelemetry(): Promise<void> {
  const processor = langfuseSpanProcessor;
  if (processor == null) {
    return;
  }

  try {
    await processor.forceFlush();
  } catch (error) {
    console.warn(
      "[observability] Langfuse telemetry flush failed; continuing without telemetry:",
      error
    );
  }
}

export function isLangfuseTelemetryEnabled(): boolean {
  return langfuseSpanProcessor != null;
}

export function withLangfuseChatTrace<T>(input: {
  chatId: string;
  chatTurnId: string;
  userId: string;
  callback: () => T | Promise<T>;
}): T | Promise<T> {
  return propagateAttributes(
    {
      traceName: "project-assistant-chat",
      sessionId: input.chatId,
      userId: input.userId,
      metadata: {
        feature: "project-assistant",
        chatTurnId: input.chatTurnId,
      },
    },
    input.callback
  );
}
