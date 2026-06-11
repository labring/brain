import { isToolUIPart, type UIMessage } from "ai";

/** Optional metadata on system rows that carry AGUI tool output (replay-safe). */
export interface AguiMessageMetadata {
  aguiCompleted?: boolean;
}

export function isAguiCompleted(msg: UIMessage): boolean {
  return (
    (msg.metadata as AguiMessageMetadata | undefined)?.aguiCompleted === true
  );
}

export function withAguiCompleted(msg: UIMessage): UIMessage {
  if (isAguiCompleted(msg)) {
    return msg;
  }
  return {
    ...msg,
    metadata: {
      ...(msg.metadata as object | undefined),
      aguiCompleted: true,
    },
  };
}

export function isGenUiSystemMessage(msg: UIMessage): boolean {
  return (
    msg.role === "system" &&
    msg.parts.some((p) => isToolUIPart(p) && p.type === "tool-emitGenUISpec")
  );
}

export function findLastGenUiSystemIndex(msgs: UIMessage[]): number {
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    const msg = msgs[i];
    if (msg !== undefined && isGenUiSystemMessage(msg)) {
      return i;
    }
  }
  return -1;
}
