"use client";

import { AppButton } from "@workspace/ui/components/app-button";
import { Spinner } from "@workspace/ui/components/spinner";
import type { ChatAddToolApproveResponseFunction, UIMessage } from "ai";
import { isToolUIPart } from "ai";
import { lazy, memo, Suspense, useEffect } from "react";
import type { EmitGenUISpecToolOutput } from "@/features/chat/agui/gen-ui-tool";

import {
  formatToolDurationMs,
  readDurationMsFromToolMetadata,
} from "./chat.tool-metrics";

// chat.gen-ui drags @json-render + the agui registry (recharts, deployer)
// into its chunk; loading it lazily keeps all of that off the eager route.
const ChatGenUIRenderer = lazy(() =>
  import("./chat.gen-ui").then((module) => ({
    default: module.ChatGenUIRenderer,
  }))
);

/** Pre-fetches the gen-UI chunk so it races the tool's own latency. */
function WarmGenUIChunk() {
  useEffect(() => {
    import("./chat.gen-ui").catch(() => undefined);
  }, []);
  return null;
}

function GenUIPendingIndicator() {
  return (
    <div
      className="flex items-center gap-2 text-muted-foreground text-xs"
      data-slot="chat-gen-ui-pending"
    >
      <Spinner className="size-4 shrink-0" />
      <span>Preparing UI spec...</span>
    </div>
  );
}

interface ChatToolProps {
  addToolApprovalResponse?: ChatAddToolApproveResponseFunction;
  part: UIMessage["parts"][number];
  partKeyPrefix: string;
}

/**
 * The AI SDK re-parses tool `input`/`output` on every chunk of the streaming
 * message, so those references churn even for settled calls — but a settled
 * tool's rendered values are frozen: `output` is written once when the call
 * completes, and the `state` flip is what triggers the render that reads it.
 * Comparing lifecycle plus the stable `toolMetadata`/`approval` references
 * keeps the gen-UI subtree (a full json-render Renderer walk) out of the
 * per-chunk render loop.
 */
function areChatToolPropsEqual(
  prev: ChatToolProps,
  next: ChatToolProps
): boolean {
  if (
    prev.addToolApprovalResponse !== next.addToolApprovalResponse ||
    prev.partKeyPrefix !== next.partKeyPrefix
  ) {
    return false;
  }
  if (prev.part === next.part) {
    return true;
  }
  if (!(isToolUIPart(prev.part) && isToolUIPart(next.part))) {
    return false;
  }
  const a = prev.part as typeof prev.part & {
    toolMetadata?: unknown;
    approval?: unknown;
  };
  const b = next.part as typeof next.part & {
    toolMetadata?: unknown;
    approval?: unknown;
  };
  return (
    a.type === b.type &&
    a.toolCallId === b.toolCallId &&
    a.state === b.state &&
    a.errorText === b.errorText &&
    a.toolMetadata === b.toolMetadata &&
    a.approval === b.approval
  );
}

/** Memoized so settled gen-UI parts skip the per-chunk streaming re-render. */
export const ChatTool = memo(function ChatTool({
  addToolApprovalResponse,
  part,
  partKeyPrefix,
}: ChatToolProps) {
  if (!(isToolUIPart(part) && part.type === "tool-emitGenUISpec")) {
    return null;
  }

  switch (part.state) {
    case "input-streaming":
    case "input-available":
      return (
        <>
          <WarmGenUIChunk />
          <GenUIPendingIndicator />
        </>
      );
    case "approval-requested": {
      return (
        <div
          className="flex max-w-full flex-col gap-2 rounded-lg border border-border bg-background p-3"
          data-slot="chat-gen-ui-approval"
        >
          <WarmGenUIChunk />
          <p className="text-foreground text-xs">
            Render the generated UI preview?
          </p>
          <div className="flex flex-wrap gap-2">
            <AppButton
              onClick={() =>
                addToolApprovalResponse?.({
                  approved: true,
                  id: part.approval.id,
                })
              }
              size="sm"
              type="button"
              variant="secondary"
            >
              Approve
            </AppButton>
            <AppButton
              onClick={() =>
                addToolApprovalResponse?.({
                  approved: false,
                  id: part.approval.id,
                  reason: "User declined to render this UI spec.",
                })
              }
              size="sm"
              type="button"
              variant="quiet"
            >
              Deny
            </AppButton>
          </div>
        </div>
      );
    }
    case "approval-responded":
      return (
        <div
          className="flex items-center gap-2 text-muted-foreground text-xs"
          data-slot="chat-gen-ui-approval-sent"
        >
          <WarmGenUIChunk />
          <Spinner className="size-4 shrink-0" />
          <span>Applying your decision...</span>
        </div>
      );
    case "output-available": {
      const out = part.output as EmitGenUISpecToolOutput;
      if (!out.ok) {
        return (
          <p
            className="rounded-md border border-destructive/35 bg-muted/40 p-2 text-destructive text-xs"
            role="alert"
          >
            {out.validationMessage}
          </p>
        );
      }
      const durationMs = readDurationMsFromToolMetadata(part.toolMetadata);
      return (
        <div className="flex w-full min-w-0 flex-col gap-1">
          <Suspense fallback={<GenUIPendingIndicator />}>
            <ChatGenUIRenderer key={`${partKeyPrefix}-spec`} spec={out.spec} />
          </Suspense>
          {durationMs === undefined ? null : (
            <p className="text-muted-foreground text-xs">
              Ran in {formatToolDurationMs(durationMs)}
            </p>
          )}
        </div>
      );
    }
    case "output-error":
      return (
        <p
          className="rounded-md border border-destructive/35 bg-muted/40 p-2 text-destructive text-xs"
          role="alert"
        >
          UI rendering failed.
        </p>
      );
    case "output-denied":
      return (
        <p
          className="rounded-md border border-border bg-muted/40 p-2 text-muted-foreground text-xs"
          role="status"
        >
          UI render cancelled
          {part.approval.reason ? ` - ${part.approval.reason}` : "."}
        </p>
      );
    default:
      return null;
  }
}, areChatToolPropsEqual);
