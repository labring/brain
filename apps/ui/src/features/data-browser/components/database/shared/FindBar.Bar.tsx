import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { ArrowDown, ArrowUp, Search, X } from "lucide-react";
import { useFindBar } from "./FindBar.Provider";

/** Always-visible find-in-page search bar matching the Figma toolbar design. */
export function FindBarBar({ className }: { className?: string }) {
  const { state, actions, meta } = useFindBar();

  const isMac = navigator.platform.toUpperCase().includes("MAC");
  const shortcutLabel = isMac ? "⌘F" : "Ctrl+F";

  return (
    <div
      className={cn(
        "flex h-11 items-center justify-between border-border border-t border-b px-2",
        className
      )}
    >
      {/* Left: search icon + input */}
      <div className="flex h-9 flex-1 items-center gap-2 px-2">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          onChange={(e) => actions.setSearchTerm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (e.shiftKey) {
                actions.goToPrevious();
              } else {
                actions.goToNext();
              }
            }
            if (e.key === "Escape") {
              e.preventDefault();
              actions.clear();
              meta.inputRef.current?.blur();
            }
          }}
          placeholder={"Find in results..."}
          ref={meta.inputRef}
          type="text"
          value={state.searchTerm}
        />
      </div>

      {/* Right: shortcut hint + match count + navigation + close */}
      <div className="flex shrink-0 items-center">
        {/* Shortcut hint — hidden when actively searching */}
        {!state.searchTerm && (
          <span className="flex size-9 select-none items-center justify-center text-foreground/20 text-sm">
            {shortcutLabel}
          </span>
        )}

        {/* Match count */}
        {state.searchTerm && (
          <span className="whitespace-nowrap px-2 text-muted-foreground text-xs tabular-nums">
            {state.total > 0
              ? `${state.currentMatchIndex + 1}/${state.total}`
              : "No results"}
          </span>
        )}

        {/* Previous match */}
        <Tooltip>
          <TooltipTrigger
            render={
              <span>
                <AppIconButton
                  aria-label="Previous match"
                  className="text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                  disabled={state.total === 0}
                  onClick={actions.goToPrevious}
                  size="lg"
                  type="button"
                  variant="quiet"
                >
                  <ArrowUp className="h-4 w-4" />
                </AppIconButton>
              </span>
            }
          />
          <TooltipContent>{"Previous match"}</TooltipContent>
        </Tooltip>

        {/* Next match */}
        <Tooltip>
          <TooltipTrigger
            render={
              <span>
                <AppIconButton
                  aria-label="Next match"
                  className="text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                  disabled={state.total === 0}
                  onClick={actions.goToNext}
                  size="lg"
                  type="button"
                  variant="quiet"
                >
                  <ArrowDown className="h-4 w-4" />
                </AppIconButton>
              </span>
            }
          />
          <TooltipContent>{"Next match"}</TooltipContent>
        </Tooltip>

        {/* Clear / close */}
        <Tooltip>
          <TooltipTrigger
            render={
              <span>
                <AppIconButton
                  aria-label="Clear search"
                  className="text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                  disabled={!state.searchTerm}
                  onClick={actions.clear}
                  size="lg"
                  type="button"
                  variant="quiet"
                >
                  <X className="h-4 w-4" />
                </AppIconButton>
              </span>
            }
          />
          <TooltipContent>{"Clear search"}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
