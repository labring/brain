"use client";

import { MessageResponse } from "@workspace/ui/components/ai-elements/message";
import {
  Task,
  TaskContent,
  TaskTrigger,
} from "@workspace/ui/components/ai-elements/task";
import { cn } from "@workspace/ui/lib/utils";
import type { ChatAddToolApproveResponseFunction, UIMessage } from "ai";
import { isToolUIPart } from "ai";
import {
  AlertCircleIcon,
  BotIcon,
  BoxIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  DatabaseIcon,
  GitBranchIcon,
  Loader2Icon,
  PackageIcon,
  SparklesIcon,
  XCircleIcon,
} from "lucide-react";
import { Fragment, type ReactNode, useEffect, useState } from "react";
import {
  deployTaskDisplayEvents,
  summarizeDeployTaskError,
} from "@/lib/deploy-task/event-display";

import { ChatTool } from "./chat.tool";
import { ChatToolGroup, type ChatToolPart } from "./chat.tool-group";

type Part = UIMessage["parts"][number];

const ACTIVE_DEPLOY_STATUSES = new Set(["applying", "queued", "running"]);

interface GithubDeployTaskData {
  error?: string | null;
  events?: { message: string | null; phase: string | null; seq: number }[];
  phase?: string;
  projectName: string;
  repoFullName: string;
  status?: string;
  taskId: string;
}

type DeployTaskSourceKind =
  | "database"
  | "docker"
  | "github"
  | "prompt"
  | "template";

interface DeployTaskData {
  error?: string | null;
  events?: { message: string | null; phase: string | null; seq: number }[];
  phase?: string;
  projectName: string;
  repoFullName?: string;
  sourceKind?: DeployTaskSourceKind;
  sourceLabel?: string;
  status?: string;
  taskId: string;
}

function isGithubDeployTaskPart(part: Part): part is Part & {
  data: GithubDeployTaskData;
  type: "data-github-deploy-task";
} {
  if (part.type !== "data-github-deploy-task") {
    return false;
  }
  const data = (part as { data?: unknown }).data;
  if (data == null || typeof data !== "object") {
    return false;
  }
  const record = data as Partial<GithubDeployTaskData>;
  return (
    typeof record.projectName === "string" &&
    typeof record.repoFullName === "string" &&
    typeof record.taskId === "string"
  );
}

function isDeployTaskPart(part: Part): part is Part & {
  data: DeployTaskData;
  type: "data-deploy-task";
} {
  if (part.type !== "data-deploy-task") {
    return false;
  }
  const data = (part as { data?: unknown }).data;
  if (data == null || typeof data !== "object") {
    return false;
  }
  const record = data as Partial<DeployTaskData>;
  return (
    typeof record.projectName === "string" && typeof record.taskId === "string"
  );
}

function messageHasDeployTaskPart(parts: Part[]): boolean {
  return parts.some(
    (part) => isDeployTaskPart(part) || isGithubDeployTaskPart(part)
  );
}

function deployStatusTone(status: string | undefined) {
  switch (status) {
    case "completed":
      return {
        className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
        icon: CheckCircle2Icon,
        label: "Completed",
      };
    case "failed":
      return {
        className: "border-destructive/35 bg-destructive/10 text-destructive",
        icon: AlertCircleIcon,
        label: "Failed",
      };
    case "cancelled":
      return {
        className:
          "border-muted-foreground/25 bg-muted/45 text-muted-foreground",
        icon: XCircleIcon,
        label: "Cancelled",
      };
    case "blocked":
      return {
        className: "border-amber-500/35 bg-amber-500/10 text-amber-300",
        icon: AlertCircleIcon,
        label: "Blocked",
      };
    default:
      return {
        className: "border-blue-400/30 bg-blue-400/10 text-blue-300",
        icon: Loader2Icon,
        label: status == null ? "Queued" : status,
      };
  }
}

function deployTaskSourceKind(
  data: DeployTaskData
): DeployTaskSourceKind | undefined {
  if (data.sourceKind != null) {
    return data.sourceKind;
  }
  return data.repoFullName == null ? undefined : "github";
}

function deployTaskSourceName(
  sourceKind: DeployTaskSourceKind | undefined
): string {
  switch (sourceKind) {
    case "database":
      return "Database";
    case "docker":
      return "Docker";
    case "github":
      return "GitHub";
    case "prompt":
      return "AI";
    case "template":
      return "Template";
    case undefined:
      return "Deployment";
    default:
      return sourceKind satisfies never;
  }
}

function deployTaskSourceLabel(data: DeployTaskData): string {
  return (
    data.sourceLabel ??
    data.repoFullName ??
    deployTaskSourceName(deployTaskSourceKind(data))
  );
}

function deployTaskSourceIcon(sourceKind: DeployTaskSourceKind | undefined) {
  switch (sourceKind) {
    case "database":
      return DatabaseIcon;
    case "docker":
      return BoxIcon;
    case "github":
      return GitBranchIcon;
    case "prompt":
      return SparklesIcon;
    case "template":
      return PackageIcon;
    case undefined:
      return BotIcon;
    default:
      return sourceKind satisfies never;
  }
}

function DeployTaskCard({ data }: { data: DeployTaskData }) {
  const status = data.status ?? "queued";
  const tone = deployStatusTone(data.status);
  const StatusIcon = tone.icon;
  const events = deployTaskDisplayEvents(data.events, 3);
  const summarizedError = summarizeDeployTaskError(data.error);
  const sourceKind = deployTaskSourceKind(data);
  const SourceIcon = deployTaskSourceIcon(sourceKind);
  const sourceName = deployTaskSourceName(sourceKind);
  const sourceLabel = deployTaskSourceLabel(data);
  const cardTitle =
    sourceKind == null ? "Deployment Task" : `${sourceName} Deploy`;
  const shouldOpenByDefault =
    ACTIVE_DEPLOY_STATUSES.has(status) || Boolean(data.error);
  const [userTouched, setUserTouched] = useState(false);
  const [open, setOpen] = useState(shouldOpenByDefault);

  useEffect(() => {
    if (!userTouched) {
      setOpen(shouldOpenByDefault);
    }
  }, [shouldOpenByDefault, userTouched]);

  return (
    <div className="w-full min-w-0" data-slot="chat-deploy-task-card">
      <Task
        onOpenChange={(next) => {
          setUserTouched(true);
          setOpen(next);
        }}
        open={open}
      >
        <TaskTrigger
          className="rounded-lg border-border bg-input/20 px-3 py-2 hover:bg-input/30"
          title={`${sourceName} deploy ${status}`}
        >
          <SourceIcon aria-hidden className="size-4 shrink-0 text-foreground" />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <p className="truncate font-medium text-foreground text-sm">
                {cardTitle}
              </p>
              <span
                className={cn(
                  "inline-flex h-5 shrink-0 items-center gap-1 rounded-md border px-1.5 font-medium text-[11px] capitalize leading-none",
                  tone.className
                )}
              >
                <StatusIcon
                  aria-hidden
                  className={cn(
                    "size-3",
                    ACTIVE_DEPLOY_STATUSES.has(status) ? "animate-spin" : ""
                  )}
                />
                {tone.label}
              </span>
            </div>
            <p className="mt-0.5 truncate text-muted-foreground text-xs">
              {sourceLabel} · {data.projectName}
            </p>
          </div>
          <ChevronDownIcon
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground transition-transform group-data-panel-open:rotate-180"
          />
        </TaskTrigger>
        <TaskContent className="mt-2">
          <div className="space-y-3 rounded-lg border border-border bg-background/45 p-3">
            <div className="grid gap-2 text-xs sm:grid-cols-2">
              <div className="min-w-0">
                <p className="text-muted-foreground">Source</p>
                <p className="truncate font-medium text-foreground">
                  {sourceLabel}
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-muted-foreground">Project</p>
                <p className="truncate font-medium text-foreground">
                  {data.projectName}
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-muted-foreground">Phase</p>
                <p className="truncate font-medium text-foreground">
                  {data.phase ?? "queued"}
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-muted-foreground">Task</p>
                <p className="truncate font-mono text-foreground">
                  {data.taskId}
                </p>
              </div>
            </div>
            {events.length > 0 ? (
              <div className="space-y-1.5">
                <p className="font-medium text-foreground text-xs">
                  Recent events
                </p>
                <ol className="space-y-1">
                  {events.map((event) => (
                    <li
                      className="grid grid-cols-[auto_1fr] gap-2 text-xs"
                      key={event.seq}
                    >
                      <span className="font-mono text-muted-foreground">
                        #{event.seq}
                      </span>
                      <span className="min-w-0 text-muted-foreground">
                        {event.phase ? (
                          <span className="mr-1 text-foreground">
                            [{event.phase}]
                          </span>
                        ) : null}
                        {event.message ?? "No details"}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
            {summarizedError ? (
              <p className="rounded-md border border-destructive/35 bg-destructive/10 p-2 text-destructive text-xs">
                {summarizedError}
              </p>
            ) : null}
            <div className="inline-flex min-w-0 items-center gap-1 text-muted-foreground text-xs">
              <SourceIcon aria-hidden className="size-3.5 shrink-0" />
              <span className="truncate">Updated by task polling</span>
            </div>
          </div>
        </TaskContent>
      </Task>
    </div>
  );
}

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
  const hideTextFallback = messageHasDeployTaskPart(parts);
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

    if (isDeployTaskPart(part) || isGithubDeployTaskPart(part)) {
      out.push(
        <DeployTaskCard
          data={part.data}
          key={`${message.id}-p-${i}-deploy-task`}
        />
      );
      i += 1;
      continue;
    }

    if (part.type === "text") {
      if (!hideTextFallback) {
        out.push(
          <Fragment key={`${message.id}-p-${i}-text`}>
            <MessageResponse>{part.text}</MessageResponse>
          </Fragment>
        );
      }
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
