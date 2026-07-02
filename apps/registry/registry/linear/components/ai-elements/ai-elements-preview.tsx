"use client";

import {
  Conversation,
  ConversationContent,
  ConversationDownload,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@workspace/ui/components/ai-elements/conversation";
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
} from "@workspace/ui/components/ai-elements/message";
import { Shimmer } from "@workspace/ui/components/ai-elements/shimmer";
import {
  Task,
  TaskContent,
  TaskItem,
  TaskItemFile,
  TaskTrigger,
} from "@workspace/ui/components/ai-elements/task";
import { Preview, PreviewWrapper } from "@workspace/ui/components/preview";
import { Spinner } from "@workspace/ui/components/spinner";
import type { UIMessage } from "ai";
import {
  ChevronDown,
  Copy,
  FileText,
  ListTodo,
  MessageSquare,
} from "lucide-react";

import { MOCK_MESSAGES } from "./ai-elements-mock";

const ASSISTANT_MARKDOWN = `You can attach a custom domain in three steps:

1. Add the domain under **Networking → Domains**.
2. Point a \`CNAME\` record at the generated target.
3. Wait for the TLS certificate to be issued.

\`\`\`bash
dig +short CNAME app.example.com
\`\`\`

Once the certificate is **Ready**, traffic resolves automatically.`;

function messageText(message: UIMessage): string {
  return message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
}

export default function AiElementsPreview() {
  return (
    <PreviewWrapper className="lg:grid-cols-1">
      <Preview title="Message">
        <div className="flex flex-col gap-4">
          <Message from="user">
            <MessageContent>
              How do I expose my app on a custom domain?
            </MessageContent>
          </Message>
          <Message from="assistant">
            <MessageContent>
              <MessageResponse>{ASSISTANT_MARKDOWN}</MessageResponse>
            </MessageContent>
            <MessageActions className="self-start">
              <MessageAction tooltip="Copy message">
                <Copy aria-hidden className="size-3" />
              </MessageAction>
            </MessageActions>
          </Message>
        </div>
      </Preview>

      <Preview title="Conversation">
        <div className="relative h-80 w-full overflow-hidden rounded-lg border border-border">
          <Conversation className="h-full">
            <ConversationContent>
              {MOCK_MESSAGES.map((message) => (
                <Message from={message.role} key={message.id}>
                  <MessageContent>
                    <MessageResponse>{messageText(message)}</MessageResponse>
                  </MessageContent>
                </Message>
              ))}
            </ConversationContent>
            <ConversationScrollButton />
            <ConversationDownload messages={MOCK_MESSAGES} />
          </Conversation>
        </div>
        <div className="h-48 w-full overflow-hidden rounded-lg border border-border border-dashed">
          <ConversationEmptyState
            description="Start a conversation to see messages here"
            icon={<MessageSquare className="size-6" />}
            title="No messages yet"
          />
        </div>
      </Preview>

      <Preview title="Shimmer">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Spinner className="size-4 shrink-0" />
            <Shimmer as="span" className="text-sm">
              Generating response…
            </Shimmer>
          </div>
          <Shimmer className="font-medium text-base">
            Thinking through the deployment plan…
          </Shimmer>
        </div>
      </Preview>

      <Preview title="Task">
        <div className="flex flex-col gap-4">
          <Task defaultOpen>
            <TaskTrigger title="Working · 0.8s">
              <ListTodo className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">
                <Shimmer as="span" className="font-medium text-sm">
                  Working · 0.8s
                </Shimmer>
              </span>
              <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-data-panel-open:rotate-180" />
            </TaskTrigger>
            <TaskContent>
              <TaskItem>
                Searched the workspace for{" "}
                <TaskItemFile>
                  <FileText aria-hidden className="size-3" />
                  chat.transcript.tsx
                </TaskItemFile>
              </TaskItem>
              <TaskItem>Reading the conversation layout…</TaskItem>
            </TaskContent>
          </Task>

          <Task defaultOpen={false}>
            <TaskTrigger title="3 tool calls in 1.2s" />
            <TaskContent>
              <TaskItem>
                Read{" "}
                <TaskItemFile>
                  <FileText aria-hidden className="size-3" />
                  message.tsx
                </TaskItemFile>
              </TaskItem>
              <TaskItem>
                Read{" "}
                <TaskItemFile>
                  <FileText aria-hidden className="size-3" />
                  task.tsx
                </TaskItemFile>
              </TaskItem>
              <TaskItem>Applied the requested style changes.</TaskItem>
            </TaskContent>
          </Task>
        </div>
      </Preview>
    </PreviewWrapper>
  );
}
