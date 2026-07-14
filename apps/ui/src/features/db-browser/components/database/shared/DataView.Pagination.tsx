import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import { AppInput } from "@workspace/ui/components/app-input";
import { AppSelect } from "@workspace/ui/components/app-select";
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

/**
 * Shared pagination controls for detail views.
 *
 * Intentional divergence from Figma 1156:453: the mock drops the first/last
 * page buttons and the total-page count, but we keep them — they are
 * navigation/orientation affordances that matter on tables running to hundreds
 * of pages. Don't remove them to "match" the mock.
 */
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
    <div className="flex items-center justify-between border-border border-t bg-transparent px-4 py-1.5">
      {/* Left cluster: range readout │ rows-per-page */}
      <div className="flex items-center gap-2">
        <span className="whitespace-nowrap text-muted-foreground text-sm">
          {`Showing ${startRow}–${endRow} of ${total}${label}`}
        </span>
        <div aria-hidden className="h-5 w-px bg-border" />
        <div className="flex items-center gap-2">
          <span className="whitespace-nowrap text-muted-foreground text-sm">
            {"Rows per page:"}
          </span>
          <AppSelect
            className="h-8 w-20 shrink-0 rounded-lg"
            onValueChange={(v) => onPageSizeChange(Number(v))}
            options={["10", "20", "50", "100"].map((size) => ({
              label: size,
              value: size,
            }))}
            value={String(pageSize)}
          />
        </div>
      </div>
      {/* Right cluster: navigation only — « ‹ [n] / N › ».
          Gap is tight (gap-0.5): the 32px ghost buttons carry their own icon
          padding, so a larger gap double-counts the spacing. */}
      <div className="flex items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger
            render={
              <span>
                <AppIconButton
                  aria-label="First page"
                  disabled={currentPage === 1 || loading}
                  onClick={() => onPageChange(1)}
                  size="md"
                  variant="quiet"
                >
                  <ChevronsLeft />
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
                  size="md"
                  variant="quiet"
                >
                  <ChevronLeft />
                </AppIconButton>
              </span>
            }
          />
          <TooltipContent>{"Previous page"}</TooltipContent>
        </Tooltip>
        <div className="mr-2 ml-1 flex items-center gap-1">
          <AppInput
            className="h-8 w-12 rounded-lg px-1 text-center"
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
          <span className="whitespace-nowrap text-muted-foreground text-sm">
            {`/ ${safeTotalPages}`}
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
                  size="md"
                  variant="quiet"
                >
                  <ChevronRight />
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
                  size="md"
                  variant="quiet"
                >
                  <ChevronsRight />
                </AppIconButton>
              </span>
            }
          />
          <TooltipContent>{"Last page"}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
