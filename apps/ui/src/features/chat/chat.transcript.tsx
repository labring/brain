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
import { Badge } from "@workspace/ui/components/badge";
import { Spinner } from "@workspace/ui/components/spinner";
import { cn } from "@workspace/ui/lib/utils";
import type { ChatStatus, UIMessage } from "ai";
import { isToolUIPart } from "ai";
import { Check, Copy } from "lucide-react";
import type { ComponentProps } from "react";
import { memo, useCallback, useState } from "react";
import { renderChatMessageParts } from "./chat.part";
import { isChatToolPartStateInFlight } from "./chat.tool-group";
import type { ChatTranscriptProps } from "./chat.types";
import {
  readSelectedContextReference,
  type SelectedContextReference,
} from "./persistence/types";
import type { SelectedContextAvailability } from "./selected-context";

/**
 * Threads are (namespace,owner)-global and unbounded, so off-screen history
 * must leave layout/paint scope while the tail streams. `auto` in
 * `contain-intrinsic-size` makes the browser remember each row's rendered
 * height — the 120px estimate only sizes rows that have never been on screen,
 * so scroll position can't jump across already-visited history.
 */
const messageRowContainmentClassName =
  "[contain-intrinsic-size:auto_120px] [content-visibility:auto]";
const assistantMessageClassName = `${messageRowContainmentClassName} max-w-full`;
const userMessageClassName = `${messageRowContainmentClassName} max-w-[82%] sm:max-w-[78%]`;
const messageContentClassName =
  "group-[.is-assistant]:w-full group-[.is-assistant]:gap-3 group-[.is-assistant]:text-foreground group-[.is-assistant]:leading-6 group-[.is-user]:rounded-2xl group-[.is-user]:rounded-br-md group-[.is-user]:border group-[.is-user]:border-border/45 group-[.is-user]:bg-input/25 group-[.is-user]:px-3 group-[.is-user]:py-2 group-[.is-user]:leading-5";

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

function selectedContextLabel(reference: SelectedContextReference): string {
  return `${reference.displayName ?? reference.name} · ${reference.kind}`;
}

function SelectedContextChip({
  availability,
  reference,
}: {
  availability: SelectedContextAvailability;
  reference: SelectedContextReference;
}) {
  const label = selectedContextLabel(reference);
  const unavailable = availability === "unavailable";
  return (
    <span
      aria-label={`Referenced: ${label}${unavailable ? " · Unavailable" : ""}`}
      className="mb-2 flex max-w-full flex-wrap items-center gap-1"
      data-slot="chat-selected-context"
      role="img"
    >
      <Badge variant="outline">{label}</Badge>
      {unavailable && <Badge variant="destructive">Unavailable</Badge>}
    </span>
  );
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

/**
 * Per-message memo boundary. The AI SDK replaces only the streaming message's
 * object on each update (settled messages keep identity), so the shallow-prop
 * bail confines per-chunk render work to the streaming tail instead of the
 * whole transcript. `copyDisabled` must stay a primitive for the same reason.
 */
const TranscriptMessage = memo(function TranscriptMessage({
  addToolApprovalResponse,
  copyDisabled,
  message,
  selectedContextAvailability,
}: {
  addToolApprovalResponse?: ChatTranscriptProps["addToolApprovalResponse"];
  copyDisabled: boolean;
  message: UIMessage;
  selectedContextAvailability?: ChatTranscriptProps["selectedContextAvailability"];
}) {
  const reference =
    message.role === "user" ? readSelectedContextReference(message) : null;
  const availability =
    reference == null || selectedContextAvailability == null
      ? "unknown"
      : selectedContextAvailability(reference);
  return (
    <Message
      className={
        message.role === "user"
          ? userMessageClassName
          : assistantMessageClassName
      }
      from={message.role}
    >
      <MessageContent className={messageContentClassName}>
        {reference != null && (
          <SelectedContextChip
            availability={availability}
            reference={reference}
          />
        )}
        {renderChatMessageParts({ addToolApprovalResponse, message })}
      </MessageContent>
      <MessageCopyAction disabled={copyDisabled} message={message} />
    </Message>
  );
});

/** Message list + scroll region; pass AI SDK message state from the host. */
export function ChatTranscript({
  addToolApprovalResponse,
  className,
  messages,
  selectedContextAvailability,
  status,
  transcriptFooter,
  ...props
}: ChatTranscriptProps & ComponentProps<"div">) {
  const showSubmittedLoading = status === "submitted";
  const showStreamingLoading = streamingAwaitingAssistantText(messages, status);
  const showLoadingRow = showSubmittedLoading || showStreamingLoading;
  const lastMessage = messages.at(-1);

  return (
    <div
      className={cn("flex min-h-0 w-full flex-1 flex-col", className)}
      data-slot="chat-transcript"
      {...props}
    >
      <Conversation className="min-h-0 w-full flex-1">
        <ConversationContent className="gap-5 px-4 py-5">
          {messages.map((message) => (
            <TranscriptMessage
              addToolApprovalResponse={addToolApprovalResponse}
              copyDisabled={status === "streaming" && message === lastMessage}
              key={message.id}
              message={message}
              selectedContextAvailability={selectedContextAvailability}
            />
          ))}
          {showLoadingRow && (
            <Message className={assistantMessageClassName} from="assistant">
              <MessageContent className={messageContentClassName}>
                <div
                  className="flex items-center gap-2 text-muted-foreground text-xs"
                  data-slot="chat-transcript-loading"
                >
                  <Spinner className="size-3.5 shrink-0" />
                  <Shimmer as="span" className="text-xs">
                    {showSubmittedLoading
                      ? "Waiting for model..."
                      : "Generating..."}
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
