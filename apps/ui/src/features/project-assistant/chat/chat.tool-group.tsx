"use client";

import { Shimmer } from "@workspace/ui/components/ai-elements/shimmer";
import {
  Task,
  TaskContent,
  TaskTrigger,
} from "@workspace/ui/components/ai-elements/task";
import { AppButton } from "@workspace/ui/components/app-button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import { Spinner } from "@workspace/ui/components/spinner";
import { cn } from "@workspace/ui/lib/utils";
import type { ChatAddToolApproveResponseFunction, UIMessage } from "ai";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ListTodoIcon,
  XCircleIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import {
  formatToolDurationMs,
  readDurationMsFromToolMetadata,
} from "./chat.tool-metrics";

/** A `ToolUIPart` from the AI SDK, narrowed for our renderer. */
export type ChatToolPart = UIMessage["parts"][number] & {
  state: string;
  toolCallId: string;
  toolMetadata?: Record<string, unknown>;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  approval?: { id: string; reason?: string };
};

const ACTIVE_TOOL_STATES = new Set([
  "input-streaming",
  "input-available",
  "approval-requested",
  "approval-responded",
]);

const SETTLED_TOOL_STATES = new Set([
  "output-available",
  "output-denied",
  "output-error",
]);

export function isChatToolPartStateInFlight(state: string): boolean {
  return ACTIVE_TOOL_STATES.has(state);
}

function isToolActive(state: string): boolean {
  return ACTIVE_TOOL_STATES.has(state);
}

function isToolSettled(state: string): boolean {
  return SETTLED_TOOL_STATES.has(state);
}

function sumKnownToolDurationsMs(toolParts: ChatToolPart[]): number {
  return toolParts.reduce((sum, p) => {
    const ms = readDurationMsFromToolMetadata(p.toolMetadata);
    return ms === undefined ? sum : sum + ms;
  }, 0);
}

function hasAnyKnownToolDuration(toolParts: ChatToolPart[]): boolean {
  return toolParts.some(
    (p) => readDurationMsFromToolMetadata(p.toolMetadata) !== undefined
  );
}

function humanizeToolType(type: string): string {
  return type.startsWith("tool-") ? type.slice("tool-".length) : type;
}

function readIntention(input: unknown): string | undefined {
  if (input === null || typeof input !== "object") {
    return;
  }
  const value = (input as { intention?: unknown }).intention;
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function ToolStatusIcon({ state }: { state: string }) {
  if (state === "output-available") {
    return (
      <CheckCircle2Icon
        aria-hidden
        className="size-3.5 shrink-0 text-emerald-400"
      />
    );
  }
  if (state === "output-error") {
    return (
      <AlertCircleIcon
        aria-hidden
        className="size-3.5 shrink-0 text-destructive"
      />
    );
  }
  if (state === "output-denied") {
    return (
      <XCircleIcon
        aria-hidden
        className="size-3.5 shrink-0 text-muted-foreground"
      />
    );
  }
  return <Spinner className="size-3.5 shrink-0 text-blue-300/80" />;
}

function PreBlock({ children }: { children: string }) {
  return (
    <pre className="max-h-56 overflow-auto rounded-md bg-background/35 p-2 font-mono text-foreground/90 text-xs leading-relaxed">
      {children}
    </pre>
  );
}

/** One tool-call row inside a `ChatToolGroup`. */
function ChatToolGroupItem({
  addToolApprovalResponse,
  part,
  partKeyPrefix,
}: {
  addToolApprovalResponse?: ChatAddToolApproveResponseFunction;
  part: ChatToolPart;
  partKeyPrefix: string;
}) {
  const intention = readIntention(part.input);
  const fallbackLabel = humanizeToolType(part.type);
  const label = intention ?? fallbackLabel;
  const active = isToolActive(part.state);
  const pendingApprovalId =
    part.state === "approval-requested" ? part.approval?.id : undefined;
  const durationMs = readDurationMsFromToolMetadata(part.toolMetadata);
  const settled = isToolSettled(part.state);

  const labelNode = active ? (
    <Shimmer as="span" className="font-medium text-sm">
      {label}
    </Shimmer>
  ) : (
    <span className="text-foreground/90 text-sm">{label}</span>
  );

  return (
    <Collapsible data-tool-part={partKeyPrefix}>
      <CollapsibleTrigger
        className={cn(
          "group/tool-row flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left",
          "transition-colors hover:bg-input/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/60"
        )}
        type="button"
      >
        <ToolStatusIcon state={part.state} />
        <span className="min-w-0 flex-1 truncate">{labelNode}</span>
        <span className="shrink-0 rounded border border-border/35 bg-input/15 px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
          {fallbackLabel}
        </span>
        {durationMs !== undefined && settled ? (
          <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
            {formatToolDurationMs(durationMs)}
          </span>
        ) : null}
        <ChevronDownIcon
          aria-hidden
          className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-panel-open/tool-row:rotate-180"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1.5 space-y-2 rounded-md bg-input/15 p-2">
          {part.input !== undefined && (
            <div>
              <p className="mb-1 font-medium text-foreground text-xs">Input</p>
              <PreBlock>{formatJson(part.input)}</PreBlock>
            </div>
          )}
          {durationMs !== undefined && settled ? (
            <p className="text-muted-foreground text-xs">
              <span className="font-medium text-foreground">Duration</span>{" "}
              {formatToolDurationMs(durationMs)}
            </p>
          ) : null}
          {part.state === "output-available" && part.output !== undefined && (
            <div>
              <p className="mb-1 font-medium text-foreground text-xs">Output</p>
              <PreBlock>{formatJson(part.output)}</PreBlock>
            </div>
          )}
          {part.state === "output-error" && (
            <div>
              <p className="mb-1 font-medium text-destructive text-xs">Error</p>
              <p className="whitespace-pre-wrap rounded-md border border-destructive/35 bg-destructive/10 p-2 text-destructive text-xs">
                {part.errorText != null && part.errorText !== ""
                  ? part.errorText
                  : "Unknown error"}
              </p>
            </div>
          )}
          {part.state === "output-denied" && (
            <p className="text-muted-foreground text-xs">
              Tool call was denied
              {part.approval?.reason != null && part.approval.reason !== ""
                ? `: ${part.approval.reason}`
                : "."}
            </p>
          )}
          {pendingApprovalId !== undefined && (
            <div className="flex flex-wrap gap-2">
              <AppButton
                onClick={() =>
                  addToolApprovalResponse?.({
                    approved: true,
                    id: pendingApprovalId,
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
                    id: pendingApprovalId,
                    reason: "User declined.",
                  })
                }
                size="sm"
                type="button"
                variant="quiet"
              >
                Deny
              </AppButton>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Groups consecutive tool-call parts into a single expandable Task. */
export function ChatToolGroup({
  addToolApprovalResponse,
  closeWhenSettled = false,
  partKeyPrefix,
  parts,
}: {
  addToolApprovalResponse?: ChatAddToolApproveResponseFunction;
  /** When true, auto-collapse the group once every tool inside has settled. */
  closeWhenSettled?: boolean;
  partKeyPrefix: string;
  parts: ChatToolPart[];
}): ReactNode {
  const anyActive = parts.some((p) => isToolActive(p.state));
  const allSettled = parts.every((p) => isToolSettled(p.state));

  const [userTouched, setUserTouched] = useState(false);
  const [open, setOpen] = useState(
    () => !(closeWhenSettled && allSettled && parts.length > 0)
  );

  useEffect(() => {
    if (userTouched) {
      return;
    }
    if (anyActive) {
      setOpen(true);
      return;
    }
    if (closeWhenSettled && allSettled) {
      setOpen(false);
    }
  }, [anyActive, allSettled, closeWhenSettled, userTouched]);

  const count = parts.length;
  const totalDurationMs = sumKnownToolDurationsMs(parts);
  const anyTimed = hasAnyKnownToolDuration(parts);
  const callsPhrase = `${count} tool ${count === 1 ? "call" : "calls"}`;

  let triggerLabel: string;
  if (anyActive) {
    triggerLabel = anyTimed
      ? `Working · ${formatToolDurationMs(totalDurationMs)}`
      : "Working";
  } else if (anyTimed) {
    triggerLabel = `${callsPhrase} in ${formatToolDurationMs(totalDurationMs)}`;
  } else {
    triggerLabel = callsPhrase;
  }

  return (
    <div
      className="w-full min-w-0 py-0.5"
      data-slot="chat-tool-group"
      data-tool-group-prefix={partKeyPrefix}
    >
      <Task
        className="border-border/35 bg-transparent p-0"
        onOpenChange={(next) => {
          setUserTouched(true);
          setOpen(next);
        }}
        open={open}
      >
        <TaskTrigger
          className="min-h-8 rounded-md px-2 py-1.5 hover:bg-input/20"
          title={triggerLabel}
        >
          <ListTodoIcon
            aria-hidden
            className="size-3.5 shrink-0 text-muted-foreground/80"
          />
          <span className="min-w-0 flex-1 truncate">
            {anyActive ? (
              <Shimmer as="span" className="font-medium text-sm">
                {triggerLabel}
              </Shimmer>
            ) : (
              <span className="font-medium text-muted-foreground text-sm">
                {triggerLabel}
              </span>
            )}
          </span>
          <ChevronDownIcon
            aria-hidden
            className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-panel-open:rotate-180"
          />
        </TaskTrigger>
        <TaskContent className="mt-1">
          {parts.map((p, i) => (
            <ChatToolGroupItem
              addToolApprovalResponse={addToolApprovalResponse}
              key={p.toolCallId}
              part={p}
              partKeyPrefix={`${partKeyPrefix}-${i}`}
            />
          ))}
        </TaskContent>
      </Task>
    </div>
  );
}
