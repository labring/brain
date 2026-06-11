"use client";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@workspace/ui/components/ai-elements/conversation";
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
} from "@workspace/ui/components/ai-elements/message";
import { Shimmer } from "@workspace/ui/components/ai-elements/shimmer";
import { Spinner } from "@workspace/ui/components/spinner";
import { cn } from "@workspace/ui/lib/utils";
import type { ChatStatus, UIMessage } from "ai";
import { isToolUIPart } from "ai";
import { Check, Copy } from "lucide-react";
import type { ComponentProps } from "react";
import { useCallback, useState } from "react";
import { renderChatMessageParts } from "./chat.part";
import { isChatToolPartStateInFlight } from "./chat.tool-group";
import type { ChatTranscriptProps } from "./chat.types";

const userBubbleClassName =
  "group-[.is-user]:rounded-3xl group-[.is-user]:rounded-br-md group-[.is-user]:border group-[.is-user]:bg-input/30 group-[.is-user]:px-3 group-[.is-user]:py-1.5";

const COPIED_FEEDBACK_MS = 1500;

function textContentForMessage(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n\n")
    .trim();
}

/** Tool activity is already shown in the transcript; avoid a duplicate loading row. */
function assistantHasInFlightToolCalls(message: UIMessage): boolean {
  for (const part of message.parts) {
    if (!(isToolUIPart(part) && part.type !== "tool-emitGenUISpec")) {
      continue;
    }
    if (isChatToolPartStateInFlight(part.state)) {
      return true;
    }
  }
  return false;
}

/** True while streaming and the in-flight assistant turn has no non-empty `text` part yet. */
function streamingAwaitingAssistantText(
  messages: UIMessage[],
  status: ChatStatus | undefined
): boolean {
  if (status !== "streaming") {
    return false;
  }
  const last = messages.at(-1);
  if (last === undefined) {
    return true;
  }
  if (last.role === "user") {
    return true;
  }
  for (const part of last.parts) {
    if (part.type === "text" && part.text.trim() !== "") {
      return false;
    }
  }
  if (assistantHasInFlightToolCalls(last)) {
    return false;
  }
  return true;
}

function MessageCopyAction({
  disabled,
  message,
}: {
  disabled?: boolean;
  message: UIMessage;
}) {
  const [copied, setCopied] = useState(false);
  const copyText = textContentForMessage(message);
  const copyable = copyText !== "";

  const copyMessage = useCallback(async () => {
    if (!copyable || disabled) {
      return;
    }
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      return;
    }
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    } catch {
      // Clipboard availability is best-effort UI affordance.
    }
  }, [copyText, copyable, disabled]);

  if (!copyable) {
    return null;
  }

  return (
    <MessageActions
      className={cn(
        "pointer-events-none opacity-0 transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100",
        message.role === "user" ? "self-end" : "self-start"
      )}
    >
      <MessageAction
        aria-label={copied ? "Copied message" : "Copy message"}
        disabled={disabled}
        onClick={() => {
          copyMessage().catch(() => undefined);
        }}
        tooltip={copied ? "Copied" : "Copy message"}
      >
        {copied ? (
          <Check aria-hidden className="size-3" />
        ) : (
          <Copy aria-hidden className="size-3" />
        )}
      </MessageAction>
    </MessageActions>
  );
}

/** Message list + scroll region; pass AI SDK message state from the host. */
export function ChatTranscript({
  addToolApprovalResponse,
  className,
  messages,
  status,
  transcriptFooter,
  ...props
}: ChatTranscriptProps & ComponentProps<"div">) {
  const showSubmittedLoading = status === "submitted";
  const showStreamingLoading = streamingAwaitingAssistantText(messages, status);
  const showLoadingRow = showSubmittedLoading || showStreamingLoading;

  return (
    <div
      className={cn("flex min-h-0 w-full flex-1 flex-col", className)}
      data-slot="chat-transcript"
      {...props}
    >
      <Conversation className="min-h-0 w-full flex-1">
        <ConversationContent>
          {messages.map((message) => (
            <Message from={message.role} key={message.id}>
              <MessageContent className={userBubbleClassName}>
                {renderChatMessageParts({
                  addToolApprovalResponse,
                  message,
                })}
              </MessageContent>
              <MessageCopyAction
                disabled={status === "streaming" && message === messages.at(-1)}
                message={message}
              />
            </Message>
          ))}
          {showLoadingRow && (
            <Message from="assistant">
              <MessageContent>
                <div
                  className="flex items-center gap-2 text-muted-foreground"
                  data-slot="chat-transcript-loading"
                >
                  <Spinner className="size-4 shrink-0" />
                  <Shimmer as="span" className="text-sm">
                    {showSubmittedLoading
                      ? "Waiting for the model to start…"
                      : "Generating response…"}
                  </Shimmer>
                </div>
              </MessageContent>
            </Message>
          )}
          {transcriptFooter != null && (
            <div
              className="w-full min-w-0 shrink-0"
              data-slot="chat-transcript-footer"
            >
              {transcriptFooter}
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
    </div>
  );
}

ChatTranscript.displayName = "Chat.Transcript";
