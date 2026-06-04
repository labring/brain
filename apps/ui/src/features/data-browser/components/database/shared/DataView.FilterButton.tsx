import { AppButton } from "@workspace/ui/components/app-button";
import { Filter } from "lucide-react";

/** Filter button with optional active count badge. */
export function DataViewFilterButton({
  onClick,
  count,
}: {
  onClick: () => void;
  count?: number;
}) {
  return (
    <AppButton
      className="min-w-[86px] gap-2.5 rounded-lg"
      data-qa-action="open"
      data-qa-module="data-view"
      data-qa-object="filter"
      data-qa-state={count ? "active" : "inactive"}
      data-testid="data-view.filter-button"
      onClick={onClick}
      variant="secondary"
    >
      <Filter className="h-4 w-4" />
      {"Filter"}
      {count ? (
        <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary-foreground px-1 font-bold text-[10px] text-primary">
          {count}
        </span>
      ) : null}
    </AppButton>
  );
}
