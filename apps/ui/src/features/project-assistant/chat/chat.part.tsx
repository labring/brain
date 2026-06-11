"use client";

import { MessageResponse } from "@workspace/ui/components/ai-elements/message";
import type { ChatAddToolApproveResponseFunction, UIMessage } from "ai";
import { isToolUIPart } from "ai";
import { Fragment, type ReactNode } from "react";

import { ChatTool } from "./chat.tool";
import { ChatToolGroup, type ChatToolPart } from "./chat.tool-group";

type Part = UIMessage["parts"][number];

/** AI SDK step boundary; do not render and do not break tool-run grouping. */
function isStepBoundaryPart(part: Part): boolean {
  return part.type === "step-start";
}

/**
 * Tool parts that should aggregate into a single `ChatToolGroup`. The
 * `emitGenUISpec` part renders its own rich UI via `ChatTool`, so it is
 * excluded from grouping.
 */
function asGroupableToolPart(part: Part): ChatToolPart | undefined {
  if (!isToolUIPart(part)) {
    return;
  }
  if (part.type === "tool-emitGenUISpec") {
    return;
  }
  return part as ChatToolPart;
}

/** Consumes optional `step-start` boundaries and merges adjacent groupable tools. */
function consumeGroupableToolRun(
  parts: Part[],
  start: number
): { groupParts: ChatToolPart[]; nextIndex: number } {
  const groupParts: ChatToolPart[] = [];
  let i = start;
  while (i < parts.length) {
    const raw = parts[i];
    if (raw === undefined) {
      break;
    }
    if (isStepBoundaryPart(raw)) {
      i += 1;
      continue;
    }
    const g = asGroupableToolPart(raw);
    if (g === undefined) {
      break;
    }
    groupParts.push(g);
    i += 1;
  }
  return { groupParts, nextIndex: i };
}

function messageTailHasNonemptyText(parts: Part[], from: number): boolean {
  return parts
    .slice(from)
    .some((p) => p.type === "text" && p.text.trim() !== "");
}

/**
 * Walks `message.parts` and returns React nodes, grouping each run of
 * consecutive tool calls into one expandable `Task`. The group auto-closes
 * once any subsequent text part appears in the same message.
 */
export function renderChatMessageParts({
  addToolApprovalResponse,
  message,
}: {
  addToolApprovalResponse?: ChatAddToolApproveResponseFunction;
  message: UIMessage;
}): ReactNode[] {
  const out: ReactNode[] = [];
  const parts = message.parts;
  let i = 0;

  while (i < parts.length) {
    const part = parts[i];
    if (part === undefined) {
      i += 1;
      continue;
    }

    if (isStepBoundaryPart(part)) {
      i += 1;
      continue;
    }

    if (asGroupableToolPart(part) !== undefined) {
      const groupStart = i;
      const { groupParts, nextIndex } = consumeGroupableToolRun(parts, i);
      i = nextIndex;
      const closeWhenSettled = messageTailHasNonemptyText(parts, i);
      out.push(
        <ChatToolGroup
          addToolApprovalResponse={addToolApprovalResponse}
          closeWhenSettled={closeWhenSettled}
          key={`${message.id}-g-${groupStart}`}
          partKeyPrefix={`${message.id}-g-${groupStart}`}
          parts={groupParts}
        />
      );
      continue;
    }

    if (part.type === "text") {
      out.push(
        <Fragment key={`${message.id}-p-${i}-text`}>
          <MessageResponse>{part.text}</MessageResponse>
        </Fragment>
      );
      i += 1;
      continue;
    }

    if (isToolUIPart(part)) {
      out.push(
        <ChatTool
          addToolApprovalResponse={addToolApprovalResponse}
          key={`${message.id}-p-${i}-tool`}
          part={part}
          partKeyPrefix={`${message.id}-p-${i}`}
        />
      );
      i += 1;
      continue;
    }

    i += 1;
  }

  return out;
}
