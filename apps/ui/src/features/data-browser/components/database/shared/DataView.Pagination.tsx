import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import { AppInput } from "@workspace/ui/components/app-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import type { PaginationProps } from "./types";

/** Shared pagination controls for detail views. */
export function DataViewPagination({
  currentPage,
  totalPages,
  pageSize,
  total,
  loading,
  itemLabel,
  onPageChange,
  onPageSizeChange,
}: PaginationProps) {
  const startRow = (currentPage - 1) * pageSize + 1;
  const endRow = Math.min(currentPage * pageSize, total);
  const label = itemLabel ? ` ${itemLabel}` : "";
  const safeTotalPages = totalPages || 1;

  return (
    <div className="flex items-center justify-between border-border border-t bg-transparent px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground text-sm">
          {`${startRow}-${endRow} of ${total}${label}`}
        </span>
      </div>
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <span className="whitespace-nowrap text-muted-foreground text-sm">
            {"Rows per page"}
          </span>
          <Select
            onValueChange={(v) => onPageSizeChange(Number(v))}
            value={String(pageSize)}
          >
            <SelectTrigger className="w-auto gap-1 border-border bg-transparent">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="10">10</SelectItem>
              <SelectItem value="20">20</SelectItem>
              <SelectItem value="50">50</SelectItem>
              <SelectItem value="100">100</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <span>
                  <AppIconButton
                    aria-label="First page"
                    disabled={currentPage === 1 || loading}
                    onClick={() => onPageChange(1)}
                    size="sm"
                    variant="secondary"
                  >
                    <ChevronsLeft className="h-3.5 w-3.5" />
                  </AppIconButton>
                </span>
              }
            />
            <TooltipContent>{"First page"}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <span>
                  <AppIconButton
                    aria-label="Previous page"
                    disabled={currentPage === 1 || loading}
                    onClick={() => onPageChange(Math.max(1, currentPage - 1))}
                    size="sm"
                    variant="secondary"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </AppIconButton>
                </span>
              }
            />
            <TooltipContent>{"Previous page"}</TooltipContent>
          </Tooltip>
          <div className="mx-2 flex items-center gap-1">
            <span className="text-muted-foreground text-sm">{"Page"}</span>
            <AppInput
              className="h-7 w-12 px-1 text-center"
              max={safeTotalPages}
              min={1}
              onChange={(e) => {
                const val = Number.parseInt(e.target.value, 10);
                if (!isNaN(val) && val >= 1) {
                  onPageChange(Math.min(val, safeTotalPages));
                }
              }}
              type="number"
              value={currentPage}
            />
            <span className="text-muted-foreground text-sm">
              {"of"} {safeTotalPages}
            </span>
          </div>
          <Tooltip>
            <TooltipTrigger
              render={
                <span>
                  <AppIconButton
                    aria-label="Next page"
                    disabled={currentPage >= safeTotalPages || loading}
                    onClick={() =>
                      onPageChange(Math.min(safeTotalPages, currentPage + 1))
                    }
                    size="sm"
                    variant="secondary"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </AppIconButton>
                </span>
              }
            />
            <TooltipContent>{"Next page"}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <span>
                  <AppIconButton
                    aria-label="Last page"
                    disabled={currentPage >= safeTotalPages || loading}
                    onClick={() => onPageChange(safeTotalPages)}
                    size="sm"
                    variant="secondary"
                  >
                    <ChevronsRight className="h-3.5 w-3.5" />
                  </AppIconButton>
                </span>
              }
            />
            <TooltipContent>{"Last page"}</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
