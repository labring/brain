import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { cn } from "@workspace/ui/lib/utils";
import { ArrowDownAZ, ArrowUpAZ, MoreHorizontal, X } from "lucide-react";
import { type ComponentProps, useState } from "react";

export type DataViewSortDirection = "asc" | "desc";

interface DataViewSortMenuProps {
  align?: ComponentProps<typeof DropdownMenuContent>["align"];
  column: string;
  onClearSort: () => void;
  onSort: (column: string, direction: DataViewSortDirection) => void;
  sortColumn: string | null;
  sortDirection: DataViewSortDirection | null;
}

const activeSortMenuItemClass =
  "bg-input focus:bg-input data-highlighted:bg-input";
const activeSortMenuIconStyle = {
  color: "var(--color-blue-400)",
  stroke: "var(--color-blue-400)",
} satisfies ComponentProps<"svg">["style"];

/** Shared DB Access column sort menu used by SQL and Redis table-like grids. */
export function DataViewSortMenu({
  align = "end",
  column,
  onClearSort,
  onSort,
  sortColumn,
  sortDirection,
}: DataViewSortMenuProps) {
  const [open, setOpen] = useState(false);
  const ascendingActive = sortColumn === column && sortDirection === "asc";
  const descendingActive = sortColumn === column && sortDirection === "desc";
  const clearEnabled = sortColumn === column;

  return (
    <DropdownMenu onOpenChange={setOpen} open={open}>
      <DropdownMenuTrigger
        render={
          <AppIconButton
            aria-label="Column actions"
            className={cn(
              "absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground",
              open && "bg-muted text-foreground"
            )}
            onClick={(event) => event.stopPropagation()}
            size="md"
            variant="quiet"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </AppIconButton>
        }
      />
      <DropdownMenuContent align={align}>
        <DropdownMenuGroup>
          <DropdownMenuLabel>{"Sort actions"}</DropdownMenuLabel>
          <DropdownMenuItem
            className={cn(ascendingActive && activeSortMenuItemClass)}
            onClick={() => onSort(column, "asc")}
          >
            <ArrowUpAZ
              style={ascendingActive ? activeSortMenuIconStyle : undefined}
            />
            {"Sort ascending"}
          </DropdownMenuItem>
          <DropdownMenuItem
            className={cn(descendingActive && activeSortMenuItemClass)}
            onClick={() => onSort(column, "desc")}
          >
            <ArrowDownAZ
              style={descendingActive ? activeSortMenuIconStyle : undefined}
            />
            {"Sort descending"}
          </DropdownMenuItem>
          {clearEnabled && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onClearSort}>
                <X />
                {"Clear sort"}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
