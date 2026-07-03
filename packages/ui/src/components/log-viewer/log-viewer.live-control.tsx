"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { Pause, Play } from "lucide-react";
import { useLogViewerContext } from "./log-viewer.context";

/**
 * The window's anchor control: pause freezes a live window in place;
 * from a frozen window, the only way back to live is this explicit action
 * (or the in-list live pill).
 */
export function LogViewerLiveControl() {
  const { logWindow, freeze, resumeLive } = useLogViewerContext();
  const isLive = logWindow.mode === "live";

  return (
    <Tooltip>
      <TooltipTrigger
        aria-label={isLive ? "Pause live logs" : "Start live logs"}
        aria-pressed={isLive}
        className={cn(
          "flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-transparent shadow-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30",
          isLive
            ? "bg-input text-blue-400 hover:bg-input/80"
            : "bg-input/30 text-brand-primary-foreground hover:bg-input"
        )}
        onClick={isLive ? freeze : resumeLive}
        type="button"
      >
        {isLive ? <Pause className="size-4" /> : <Play className="size-4" />}
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {isLive ? "Pause live logs" : "Start live logs"}
      </TooltipContent>
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
      className="absolute bottom-3 left-1/2 z-10 flex h-8 -translate-x-1/2 cursor-pointer items-center gap-1.5 rounded-full border border-border bg-input/30 px-3.5 font-medium text-foreground text-sm shadow-[0px_2px_4px_0px_rgba(8,10,17,0.25),inset_-1px_-1px_4px_0px_rgba(8,10,17,0.25)] backdrop-blur-lg transition-colors hover:bg-input/50"
      onClick={resumeLive}
      type="button"
    >
      <span aria-hidden className="size-1.5 rounded-full bg-blue-400" />
      Go live
    </button>
  );
}
