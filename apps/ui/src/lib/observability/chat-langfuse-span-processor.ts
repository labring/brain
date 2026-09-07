import { LangfuseSpanProcessor } from "@langfuse/otel";

type ReadableSpan = Parameters<LangfuseSpanProcessor["onEnd"]>[0];

/**
 * AI SDK's recordInputs/recordOutputs flags do not cover exception events or
 * status messages. Remote tool/provider errors may contain credentials or raw
 * command output (ADR-0056). Only the error status code may leave this process.
 * Langfuse's mask callback does not cover these OpenTelemetry fields either.
 */
export class ChatLangfuseSpanProcessor extends LangfuseSpanProcessor {
  override onEnd(span: ReadableSpan): void {
    // Copy the public ReadableSpan contract: spreading a live SDK span loses
    // prototype getters such as duration and can affect sibling processors.
    try {
      super.onEnd({
        name: span.name,
        kind: span.kind,
        spanContext: () => span.spanContext(),
        parentSpanContext: span.parentSpanContext,
        startTime: span.startTime,
        endTime: span.endTime,
        status: { code: span.status.code },
        attributes: Object.fromEntries(
          Object.entries(span.attributes).filter(
            ([key]) =>
              !(key.startsWith("exception.") || key.startsWith("error.")) &&
              key !== "langfuse.observation.status_message"
          )
        ),
        events: span.events.filter((event) => event.name !== "exception"),
        links: span.links,
        duration: span.duration,
        ended: span.ended,
        resource: span.resource,
        instrumentationScope: span.instrumentationScope,
        droppedAttributesCount: span.droppedAttributesCount,
        droppedEventsCount: span.droppedEventsCount,
        droppedLinksCount: span.droppedLinksCount,
      });
    } catch {
      console.warn("[observability] Could not export a Chat span.");
    }
  }
}
