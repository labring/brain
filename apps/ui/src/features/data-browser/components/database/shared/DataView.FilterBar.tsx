import { AppButton } from "@workspace/ui/components/app-button";
import { X } from "lucide-react";
import type { FilterChip } from "./types";

/** Shared filter bar with dismissible chips. */
export function DataViewFilterBar({
  filters,
  onClearAll,
}: {
  filters: FilterChip[];
  onClearAll: () => void;
}) {
  if (filters.length === 0) {
    return null;
  }

  return (
    <div className="slide-in-from-top-2 flex animate-in flex-wrap items-center gap-2 border-border/50 border-b bg-muted/30 px-6 py-2 duration-200">
      <span className="mr-2 font-medium text-muted-foreground text-xs">
        {"Filtered by"}
      </span>
      {filters.map((chip) => (
        <div
          className="flex items-center gap-1 rounded-full border border-border bg-background px-3 py-1 text-xs shadow-sm"
          key={chip.id}
        >
          <span className="text-muted-foreground">{chip.label}</span>
          <span className="font-medium">{chip.value}</span>
          <button
            className="ml-1 hover:text-destructive"
            onClick={chip.onRemove}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
      <AppButton
        className="ml-auto h-6 text-muted-foreground text-xs hover:text-destructive"
        onClick={onClearAll}
        size="sm"
        variant="quiet"
      >
        {"Clear all"}
      </AppButton>
    </div>
  );
}
