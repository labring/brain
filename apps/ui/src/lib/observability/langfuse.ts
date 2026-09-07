import "server-only";

import { LangfuseVercelAiSdkIntegration } from "@langfuse/vercel-ai-sdk";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { registerTelemetry } from "ai";

import { ChatLangfuseSpanProcessor } from "./chat-langfuse-span-processor";

import { getLangfuseConfigFromEnv } from "./langfuse-core";

let initialization: Promise<boolean> | undefined;
let langfuseSpanProcessor: ChatLangfuseSpanProcessor | undefined;

/**
 * Starts the Langfuse OpenTelemetry exporter once per Node.js process.
 * Observability is deliberately fail-open: bad or unavailable Langfuse
 * configuration must never prevent Brain from serving chat or other routes.
 */
export function initializeLangfuseTelemetry(): Promise<boolean> {
  initialization ??= Promise.resolve().then(() => {
    const config = getLangfuseConfigFromEnv(process.env);
    if (config == null) {
      return false;
    }

    let sdk: NodeSDK | undefined;
    try {
      const spanProcessor = new ChatLangfuseSpanProcessor({
        publicKey: config.publicKey,
        secretKey: config.secretKey,
        baseUrl: config.baseUrl,
      });
      sdk = new NodeSDK({ spanProcessors: [spanProcessor] });
      sdk.start();
      registerTelemetry(new LangfuseVercelAiSdkIntegration());
      langfuseSpanProcessor = spanProcessor;
      console.info(
        `[observability] Chat Assistant telemetry enabled (${config.baseUrl}).`
      );
      return true;
    } catch {
      Promise.resolve()
        .then(() => sdk?.shutdown())
        .catch(() => {
          console.warn(
            "[observability] Could not shut down failed telemetry initialization."
          );
        });
      console.warn(
        "[observability] Langfuse telemetry failed to initialize; continuing without telemetry."
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
