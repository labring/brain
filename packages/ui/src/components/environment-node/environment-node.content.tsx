"use client";

import {
  CanvasNode,
  type CanvasNodeMetricListItem,
} from "@workspace/ui/components/canvas-node/canvas-node";
import { cn } from "@workspace/ui/lib/utils";
import {
  Activity,
  Code2,
  Cpu,
  FileText,
  HardDrive,
  MemoryStick,
  Pause,
  Play,
  RotateCcw,
  SquareTerminal,
  Trash2,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";

import { useEnvironmentNode } from "./environment-node.context";
import {
  canCopyEnvironmentLaunchCommand,
  ENVIRONMENT_NODE_LAUNCH_COMMAND_COPY_KEY,
} from "./environment-node.root";
import { resolveEnvironmentNodeStatus } from "./environment-node.status";
import type {
  EnvironmentNodeLifecycleActionKey,
  EnvironmentNodeMetricKey,
  EnvironmentNodeQuickActionKey,
} from "./environment-node.types";
import {
  type EnvironmentRuntimeTone,
  getEnvironmentRuntimeIcon,
  getEnvironmentRuntimeTone,
} from "./environment-runtime-icons";

const METRIC_ITEMS = [
  { icon: Cpu, key: "cpu", label: "CPU" },
  { icon: MemoryStick, key: "memory", label: "Memory" },
  { icon: HardDrive, key: "storage", label: "Storage" },
] as const satisfies readonly CanvasNodeMetricListItem<EnvironmentNodeMetricKey>[];

const QUICK_ACTION_ITEMS = [
  {
    icon: SquareTerminal,
    key: "terminal",
    label: "Open terminal",
    tooltip: "Terminal",
  },
  { icon: FileText, key: "logs", label: "Open logs", tooltip: "Logs" },
  { icon: Activity, key: "metrics", label: "Open metrics", tooltip: "Metrics" },
  { icon: Code2, key: "ide", label: "Open IDE", tooltip: "IDE" },
] as const satisfies readonly {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  key: EnvironmentNodeQuickActionKey;
  label: string;
  tooltip: string;
}[];

interface LifecycleActionItem {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  key: EnvironmentNodeLifecycleActionKey;
  label: string;
  tone?: "destructive" | "info" | "muted" | "success";
}

const LIFECYCLE_ACTION_ITEMS: readonly LifecycleActionItem[] = [
  { icon: Play, key: "start", label: "Start", tone: "success" },
  { icon: Pause, key: "stop", label: "Stop", tone: "muted" },
  { icon: RotateCcw, key: "restart", label: "Restart", tone: "info" },
  { icon: Trash2, key: "delete", label: "Delete", tone: "destructive" },
] as const;

function formatEnvironmentSubtitle({
  displayRuntime,
  formattedVersion,
}: {
  displayRuntime: string;
  formattedVersion?: string;
}) {
  const runtime = displayRuntime.trim() || "Unknown runtime";

  return `Environment ${runtime}${formattedVersion ? ` ${formattedVersion}` : ""}`;
}

function getRuntimeToneClassName(tone: EnvironmentRuntimeTone) {
  switch (tone) {
    case "blue":
      return "text-blue-400";
    case "cyan":
      return "text-cyan-400";
    case "green":
      return "text-green-400";
    case "orange":
      return "text-orange-400";
    case "purple":
      return "text-purple-400";
    case "red":
      return "text-red-400";
    case "yellow":
      return "text-yellow-400";
    default:
      return "text-zinc-50";
  }
}

export function EnvironmentNodeContent() {
  return (
    <CanvasNode.Card surfaceClassName="environment-node-surface">
      <CanvasNode.Header>
        <EnvironmentNodeHeaderContent />
      </CanvasNode.Header>
      <CanvasNode.Body>
        <EnvironmentNodeBodyContent />
      </CanvasNode.Body>
      <CanvasNode.Footer>
        <EnvironmentNodeFooterContent />
      </CanvasNode.Footer>
    </CanvasNode.Card>
  );
}

export function EnvironmentNodeHeaderContent({
  className,
}: {
  className?: string;
}) {
  const {
    state: { states },
  } = useEnvironmentNode();
  const Icon = getEnvironmentRuntimeIcon(states.runtimeKey);
  const runtimeTone = getEnvironmentRuntimeTone(states.runtimeKey);
  const subtitle = formatEnvironmentSubtitle(states);

  return (
    <div className={cn("flex min-w-0 flex-1 items-center gap-1.5", className)}>
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/5",
            getRuntimeToneClassName(runtimeTone)
          )}
        >
          <Icon aria-hidden className="size-4" strokeWidth={2} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span
            className="min-w-0 truncate font-normal text-sm text-zinc-50 leading-5"
            title={states.name}
          >
            {states.name}
          </span>
          <span
            className="min-w-0 truncate font-normal text-muted-foreground text-xs leading-4"
            title={subtitle}
          >
            {subtitle}
          </span>
        </span>
      </span>
      <EnvironmentNodeHeaderMenu />
    </div>
  );
}

export function EnvironmentNodeBodyContent({
  className,
}: {
  className?: string;
}) {
  return (
    <div className={cn("environment-node-body-content pt-2.5", className)}>
      <EnvironmentNodeLaunchCommand />
      <EnvironmentNodeActionBar />
    </div>
  );
}

export function EnvironmentNodeLaunchCommand({
  className,
}: {
  className?: string;
}) {
  const {
    actions,
    state: { launchCommand },
  } = useEnvironmentNode();
  const copyable = canCopyEnvironmentLaunchCommand(launchCommand);
  const displayValue = copyable
    ? launchCommand
    : "No launch command configured";

  return (
    <CanvasNode.CopyableRow
      className={cn(
        "environment-node-launch-command-row relative flex min-w-0 flex-col gap-2 rounded-lg bg-zinc-950/20 p-2.5 transition-colors",
        !copyable && "environment-node-launch-command-row-static",
        className
      )}
      copyAriaLabel="Copy launch command"
      copyable={copyable}
      copyValue={launchCommand}
      data-slot="environment-node-launch-command-row"
      onCopy={
        actions.copyLaunchCommand
          ? (value) => actions.copyLaunchCommand?.(value)
          : undefined
      }
      rowKey={ENVIRONMENT_NODE_LAUNCH_COMMAND_COPY_KEY}
      title={launchCommand}
    >
      {({ copied, copyable: rowCopyable }) => (
        <>
          <div
            className={cn(
              "relative z-10 flex min-w-0 items-center justify-between gap-2",
              rowCopyable ? "pointer-events-none" : "pointer-events-auto"
            )}
          >
            <span className="min-w-0 truncate font-normal text-muted-foreground text-xs leading-4">
              Launch command
            </span>
          </div>
          <div
            aria-hidden={rowCopyable ? true : undefined}
            className={cn(
              "relative z-10 flex h-7 min-w-0 items-center justify-between gap-2 py-1.5 text-left font-normal text-xs leading-4",
              rowCopyable
                ? "pointer-events-none text-zinc-50"
                : "text-muted-foreground"
            )}
            data-copied={copied ? "true" : undefined}
            data-slot="environment-node-launch-command-value"
            title={launchCommand ?? displayValue}
          >
            <span className="min-w-0 truncate">{displayValue}</span>
            <CanvasNode.CopyableRowIndicator />
          </div>
        </>
      )}
    </CanvasNode.CopyableRow>
  );
}

export function EnvironmentNodeActionBar({
  className,
}: {
  className?: string;
}) {
  const {
    actions: { quickActions },
  } = useEnvironmentNode();

  return (
    <CanvasNode.ActionBar className={className}>
      {QUICK_ACTION_ITEMS.map((item) => {
        const action = quickActions?.[item.key];
        const Icon = item.icon;

        return (
          <CanvasNode.ActionButton
            action={action}
            aria-label={item.label}
            key={item.key}
            title={item.tooltip}
          >
            <Icon aria-hidden className="size-4" />
          </CanvasNode.ActionButton>
        );
      })}
    </CanvasNode.ActionBar>
  );
}

export function EnvironmentNodeFooterContent({
  className,
}: {
  className?: string;
}) {
  const {
    state: {
      states: { metrics, status },
    },
  } = useEnvironmentNode();
  const visualStatus = resolveEnvironmentNodeStatus(status);

  return (
    <div
      className={cn(
        "environment-node-footer-content flex w-full min-w-0 items-center justify-between gap-2 text-xs leading-none",
        className
      )}
      data-slot="environment-node-footer-content"
    >
      <CanvasNode.FooterStatus status={visualStatus} />
      <CanvasNode.MetricList items={METRIC_ITEMS} values={metrics} />
    </div>
  );
}

function EnvironmentNodeHeaderMenu() {
  const {
    actions: { lifecycleActions },
  } = useEnvironmentNode();

  return (
    <CanvasNode.ActionMenu aria-label="Open environment actions">
      {LIFECYCLE_ACTION_ITEMS.map((item) => {
        const action = lifecycleActions?.[item.key];
        const Icon = item.icon;

        return (
          <CanvasNode.ActionMenuItem
            action={action}
            actionKey={item.key}
            icon={<Icon aria-hidden className="size-4" />}
            key={item.key}
            tone={item.tone}
          >
            {item.label}
          </CanvasNode.ActionMenuItem>
        );
      })}
    </CanvasNode.ActionMenu>
  );
}
