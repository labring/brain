"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { Pause } from "lucide-react";
import { useLogViewerContext } from "./log-viewer.context";

/**
 * The window's anchor control: pause freezes a live window in place;
 * from a frozen window, the only way back to live is this explicit action
 * (or the in-list live pill).
 */
export function LogViewerLiveControl() {
  const { logWindow, freeze, resumeLive } = useLogViewerContext();

  if (logWindow.mode === "live") {
    return (
      <Tooltip>
        <TooltipTrigger
          aria-label="Pause — freeze this window"
          className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md border border-transparent bg-input text-blue-400 shadow-none transition-colors hover:bg-input/80 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
          onClick={freeze}
          type="button"
        >
          <Pause className="size-4" />
        </TooltipTrigger>
        <TooltipContent side="bottom">
          Pause — freeze this window
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger
        aria-label="Back to live"
        className="flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-transparent bg-input/30 px-3 text-foreground text-sm shadow-none transition-colors hover:bg-input focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
        onClick={resumeLive}
        type="button"
      >
        <span aria-hidden className="size-2 rounded-full bg-blue-400" />
        Live
      </TooltipTrigger>
      <TooltipContent side="bottom">Back to live</TooltipContent>
    </Tooltip>
  );
}

/**
 * Persistent exit from any frozen window, floating at the tail — the place
 * live output would appear. Hidden while live.
 */
export function LogViewerLivePill() {
  const { logWindow, resumeLive } = useLogViewerContext();

  if (logWindow.mode === "live") {
    return null;
  }

  return (
    <button
      className="absolute bottom-3 left-1/2 z-10 flex h-7 -translate-x-1/2 cursor-pointer items-center gap-1.5 rounded-full border border-border bg-background/80 px-3 font-medium text-foreground text-xs shadow-sm backdrop-blur transition-colors hover:bg-input/50"
      onClick={resumeLive}
      type="button"
    >
      <span aria-hidden className="size-1.5 rounded-full bg-blue-400" />
      Live
    </button>
  );
}
