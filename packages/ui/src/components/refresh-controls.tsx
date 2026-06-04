"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { Pause, Play } from "lucide-react";

interface LivePauseToggleProps {
  disabled?: boolean;
  isLive: boolean;
  onToggle: () => void;
}

export function LivePauseToggle({
  disabled = false,
  isLive,
  onToggle,
}: LivePauseToggleProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        aria-label={isLive ? "Pause live logs" : "Start live logs"}
        aria-pressed={isLive}
        className={cn(
          "flex size-9 cursor-pointer items-center justify-center rounded-lg border border-transparent shadow-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50",
          isLive
            ? "bg-input text-blue-400 hover:bg-input/80"
            : "bg-input/30 text-brand-primary-foreground hover:bg-input"
        )}
        disabled={disabled}
        onClick={onToggle}
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
