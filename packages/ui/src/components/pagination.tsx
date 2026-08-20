import { Button } from "@workspace/ui/components/button";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";

interface PaginationProps {
  currentPage: number;
  onPageChange: (page: number) => void;
  totalPages: number;
}

function Pagination({
  currentPage,
  totalPages,
  onPageChange,
}: PaginationProps) {
  const lastPage = Math.max(1, Math.trunc(totalPages));
  const page = Math.min(Math.max(1, Math.trunc(currentPage)), lastPage);
  const isFirstPage = page === 1;
  const isLastPage = page === lastPage;

  return (
    <nav aria-label="Pagination" data-slot="pagination">
      <div className="flex items-center gap-2">
        <Button
          aria-label="First page"
          className="rounded-full shadow-none"
          disabled={isFirstPage}
          onClick={() => onPageChange(1)}
          size="icon"
          type="button"
          variant="outline"
        >
          <ChevronsLeft aria-hidden />
        </Button>
        <Button
          aria-label="Previous page"
          className="rounded-full shadow-none"
          disabled={isFirstPage}
          onClick={() => onPageChange(page - 1)}
          size="icon"
          type="button"
          variant="outline"
        >
          <ChevronLeft aria-hidden />
        </Button>
        <div
          aria-live="polite"
          className="flex min-w-12 items-center justify-center gap-1 font-medium text-sm"
        >
          <span className="text-foreground">{page}</span>
          <span aria-hidden className="text-muted-foreground">
            /
          </span>
          <span className="text-muted-foreground">{lastPage}</span>
        </div>
        <Button
          aria-label="Next page"
          className="rounded-full shadow-none"
          disabled={isLastPage}
          onClick={() => onPageChange(page + 1)}
          size="icon"
          type="button"
          variant="outline"
        >
          <ChevronRight aria-hidden />
        </Button>
        <Button
          aria-label="Last page"
          className="rounded-full shadow-none"
          disabled={isLastPage}
          onClick={() => onPageChange(lastPage)}
          size="icon"
          type="button"
          variant="outline"
        >
          <ChevronsRight aria-hidden />
        </Button>
      </div>
    </nav>
  );
}

export type { PaginationProps };
export { Pagination };
