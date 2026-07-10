"use client";

import { useStatusHeartbeat } from "@workspace/ui/lib/status-heartbeat";
import { cn } from "@workspace/ui/lib/utils";

import type {
  CanvasNodeStatus as CanvasNodeStatusData,
  CanvasNodeVisualStatusTone,
} from "./canvas-node.types";

interface StatusVisual {
  breathing: boolean;
  dotClassName: string;
  pillClassName: string;
  textClassName: string;
}

const GREEN: StatusVisual = {
  breathing: true,
  dotClassName: "bg-green-500",
  pillClassName: "bg-green-500/30 text-zinc-50",
  textClassName: "text-green-500",
};
const BLUE: StatusVisual = {
  breathing: true,
  dotClassName: "bg-blue-500",
  pillClassName: "bg-blue-500/30 text-zinc-50",
  textClassName: "text-blue-500",
};
const YELLOW: StatusVisual = {
  breathing: true,
  dotClassName: "bg-yellow-500",
  pillClassName: "bg-yellow-500/30 text-zinc-50",
  textClassName: "text-yellow-500",
};
const GRAY_STATIC: StatusVisual = {
  breathing: false,
  dotClassName: "bg-neutral-500",
  pillClassName: "bg-neutral-500/30 text-zinc-50",
  textClassName: "text-neutral-400",
};
const RED: StatusVisual = {
  breathing: true,
  dotClassName: "bg-red-500",
  pillClassName: "bg-red-500/30 text-zinc-50",
  textClassName: "text-red-500",
};

export const DEFAULT_CANVAS_NODE_STATUS = {
  label: "Unknown",
  visualTone: "neutral",
} as const satisfies CanvasNodeStatusData;

export function normalizeCanvasNodeVisualTone(
  input: string | undefined
): CanvasNodeVisualStatusTone {
  const normalized = input
    ?.trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");

  switch (normalized) {
    case "positive":
      return normalized;
    case "progress":
      return normalized;
    case "warning":
      return normalized;
    case "negative":
      return normalized;
    case "neutral":
      return normalized;
    default:
      return "neutral";
  }
}

export function resolveCanvasNodeStatus(
  status: CanvasNodeStatusData | undefined
): Required<CanvasNodeStatusData> {
  return {
    label: status?.label?.trim() || DEFAULT_CANVAS_NODE_STATUS.label,
    visualTone: normalizeCanvasNodeVisualTone(status?.visualTone),
  };
}

function getStatusVisual(tone: CanvasNodeVisualStatusTone): StatusVisual {
  switch (tone) {
    case "positive":
      return GREEN;
    case "progress":
      return BLUE;
    case "warning":
      return YELLOW;
    case "negative":
      return RED;
    case "neutral":
      return GRAY_STATIC;
    default:
      return GRAY_STATIC;
  }
}

export function getCanvasNodeStatusTextClassName(
  status: CanvasNodeStatusData | undefined
) {
  const resolvedStatus = resolveCanvasNodeStatus(status);
  return getStatusVisual(resolvedStatus.visualTone).textClassName;
}

export function CanvasNodeStatusDot({
  className,
  size = "default",
  status,
}: {
  className?: string;
  size?: "collapsed" | "default" | "small";
  status?: CanvasNodeStatusData;
}) {
  const resolvedStatus = resolveCanvasNodeStatus(status);
  const visual = getStatusVisual(resolvedStatus.visualTone);
  useStatusHeartbeat(visual.breathing);
  const dotSize = size === "default" ? "size-3" : "size-2";
  const pingSize = size === "default" ? "size-2.5" : "size-2";

  return (
    <span
      aria-hidden
      className={cn(
        "relative flex shrink-0 items-center justify-center rounded-full",
        size === "default" ? "size-4" : "size-3.5",
        className
      )}
    >
      {visual.breathing ? (
        <span
          className={cn(
            "status-heartbeat-ping absolute rounded-full opacity-75",
            pingSize,
            visual.dotClassName
          )}
        />
      ) : null}
      <span
        className={cn("relative rounded-full", dotSize, visual.dotClassName)}
      />
    </span>
  );
}

export function CanvasNodeStatusPill({
  className,
  status,
}: {
  className?: string;
  status?: CanvasNodeStatusData;
}) {
  const resolvedStatus = resolveCanvasNodeStatus(status);
  const visual = getStatusVisual(resolvedStatus.visualTone);

  return (
    <span
      className={cn(
        "flex h-5 shrink-0 items-center gap-2.5 rounded-full py-0.5 pr-1 pl-2.5 font-normal text-xs leading-none",
        visual.pillClassName,
        className
      )}
    >
      <span className="truncate">{resolvedStatus.label}</span>
      <CanvasNodeStatusDot size="small" status={status} />
    </span>
  );
}

export function CanvasNodeStatus({
  className,
  status,
}: {
  className?: string;
  status?: CanvasNodeStatusData;
}) {
  return (
    <span
      className={cn(
        "canvas-node-status flex size-8 shrink-0 items-center justify-center",
        className
      )}
    >
      <CanvasNodeStatusDot
        className="canvas-node-status-dot"
        size="collapsed"
        status={status}
      />
    </span>
  );
}
