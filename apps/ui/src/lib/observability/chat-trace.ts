import { propagateAttributes, startActiveObservation } from "@langfuse/tracing";
import { context } from "@opentelemetry/api";

export interface ChatTrace {
  completed: Promise<void>;
  end: () => void;
  run: <T>(callback: () => T) => T;
}

export async function withLangfuseChatTrace<T>(input: {
  chatId: string;
  chatTurnId: string;
  userId: string;
  callback: (trace: ChatTrace) => T | Promise<T>;
}): Promise<T> {
  // Keep the application result separate: a tracing failure must never retry a
  // turn that may already have reserved quota, written history or called tools.
  let callbackResult: Promise<T> | undefined;
  const invoke = (trace: ChatTrace) => {
    callbackResult ??= Promise.resolve().then(() => input.callback(trace));
    return callbackResult;
  };
  const untraced: ChatTrace = {
    completed: Promise.resolve(),
    end: () => undefined,
    run: (callback) => callback(),
  };
  try {
    return await propagateAttributes(
      {
        traceName: "project-assistant-chat",
        sessionId: input.chatId,
        userId: input.userId,
        metadata: {
          feature: "project-assistant",
          chatTurnId: input.chatTurnId,
        },
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
              run: (callback) => {
                let result: (() => ReturnType<typeof callback>) | undefined;
                try {
                  return context.with(activeContext, () => {
                    try {
                      const value = callback();
                      result = () => value;
                      return value;
                    } catch (error) {
                      result = () => {
                        throw error;
                      };
                      throw error;
                    }
                  });
                } catch {
                  // Preserve both values and application errors, without replay.
                  return result ? result() : callback();
                }
              },
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
              return await invoke(trace);
            } catch (error) {
              trace.end();
              throw error;
            }
          },
          { endOnExit: false }
        )
    );
  } catch {
    if (callbackResult) {
      return callbackResult;
    }
    console.warn(
      "[observability] Could not start the Chat trace; continuing without telemetry."
    );
    return invoke(untraced);
  }
}
