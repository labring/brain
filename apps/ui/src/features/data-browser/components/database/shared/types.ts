export interface Alert {
  message: string;
  title: string;
  type: "success" | "error" | "info";
}

/** Props for the shared pagination controls. */
export interface PaginationProps {
  currentPage: number;
  /** Label for items (e.g., "keys", "documents"). Defaults to empty string. */
  itemLabel?: string;
  loading?: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** A single dismissible filter chip. */
export interface FilterChip {
  id: string;
  label: string;
  onRemove: () => void;
  value: string;
}
