import { propagateAttributes, startActiveObservation } from "@langfuse/tracing";
import { context } from "@opentelemetry/api";

export interface ChatTrace {
  completed: Promise<void>;
  end: () => void;
  run: <T>(callback: () => T) => T;
}

export function withLangfuseChatTrace<T>(input: {
  chatId: string;
  chatTurnId: string;
  userId: string;
  callback: (trace: ChatTrace) => T | Promise<T>;
}): Promise<T> {
  return propagateAttributes(
    {
      traceName: "project-assistant-chat",
      sessionId: input.chatId,
      userId: input.userId,
      metadata: { feature: "project-assistant", chatTurnId: input.chatTurnId },
    },
    () =>
      startActiveObservation(
        "project-assistant-chat",
        async (observation) => {
          const activeContext = context.active();
          let complete: () => void = () => undefined;
          const completed = new Promise<void>((resolve) => {
            complete = resolve;
          });
          let ended = false;
          const trace: ChatTrace = {
            completed,
            run: (callback) => context.with(activeContext, callback),
            end: () => {
              if (ended) {
                return;
              }
              ended = true;
              try {
                observation.end();
              } catch {
                console.warn("[observability] Could not end the Chat trace.");
              } finally {
                complete();
              }
            },
          };
          try {
            return await input.callback(trace);
          } catch (error) {
            trace.end();
            throw error;
          }
        },
        { endOnExit: false }
      )
  );
}
