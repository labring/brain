import { propagateAttributes, startActiveObservation } from "@langfuse/tracing";

export interface ChatTrace {
  completed: Promise<void>;
  end: () => void;
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
  const untraced: ChatTrace = {
    completed: Promise.resolve(),
    end: () => undefined,
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
            let complete: () => void = () => undefined;
            const completed = new Promise<void>((resolve) => {
              complete = resolve;
            });
            let ended = false;
            const trace: ChatTrace = {
              completed,
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
              callbackResult = Promise.resolve().then(() =>
                input.callback(trace)
              );
              return await callbackResult;
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
    return input.callback(untraced);
  }
}
